"""The session server: HTTP for tokens, one WebSocket for clients, one for
VMs, and the web app as static files."""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC
from pathlib import Path
from typing import Any

from fastapi import (
    Depends,
    FastAPI,
    Header,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from apparatus_protocol import (
    A2S,
    C2S,
    S2C,
    HandoffOutcome,
    ProtocolError,
    dumps,
    msg,
    parse,
)

from .audit import Audit
from .auth import Authenticator, AuthError, make_authenticator
from .clients import ClientConn, ClientHub
from .config import Settings, load_settings
from .jobs import JobManager
from .ledger import DailyCapReached, InsufficientCredits, Ledger
from .model import SmartModel, make_smart_model
from .push import Push, make_push
from .sessions import ModelSummarizer, NaiveSummarizer, Sessions
from .smart import SMART_SYSTEM_PROMPT
from .store import Store, make_store
from .tokens import TokenMinter, make_token_minter
from .vm import IdleStopper, VmController, VmLink, VmRegistry, make_vm_controller, verify_enrollment
from .voice import live_connect_config, live_setup_message

log = logging.getLogger("apparatus")


@dataclass
class Deps:
    settings: Settings
    store: Store
    ledger: Ledger
    audit: Audit
    auth: Authenticator
    tokens: TokenMinter
    model: SmartModel
    push: Push
    vm_controller: VmController
    vms: VmRegistry
    clients: ClientHub
    sessions: Sessions
    jobs: JobManager
    idle: IdleStopper


def build_deps(
    settings: Settings,
    *,
    store: Store | None = None,
    model: SmartModel | None = None,
    tokens: TokenMinter | None = None,
    push: Push | None = None,
    vm_controller: VmController | None = None,
    auth: Authenticator | None = None,
) -> Deps:
    store = store or make_store(settings.store, settings.data_dir)
    model = make_smart_model(settings.gemini_api_key, model)
    ledger = Ledger(store, settings.credits, settings.prices)
    audit = Audit(store)
    vms = VmRegistry()
    clients = ClientHub(store)
    summarizer = (
        ModelSummarizer(model, settings.models.smart)
        if settings.gemini_api_key
        else NaiveSummarizer()
    )
    sessions = Sessions(store, summarizer, max_chars=settings.live.summary_max_chars)
    push = push or make_push(settings.push, settings.firebase_project_id)
    vm_controller = vm_controller or make_vm_controller(
        settings.vm_controller, settings.gce_project, settings.gce_zone
    )
    jobs = JobManager(
        settings, store, ledger, audit, vms, clients, model, push, vm_controller, sessions
    )
    idle = IdleStopper(
        vm_controller, vms, jobs.is_busy, jobs.last_activity_at, settings.vm.idle_stop_minutes
    )
    return Deps(
        settings=settings,
        store=store,
        ledger=ledger,
        audit=audit,
        auth=auth or make_authenticator(settings.auth_mode, settings.firebase_project_id),
        tokens=tokens or make_token_minter(settings.gemini_api_key),
        model=model,
        push=push,
        vm_controller=vm_controller,
        vms=vms,
        clients=clients,
        sessions=sessions,
        jobs=jobs,
        idle=idle,
    )


def create_app(deps: Deps) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        deps.idle.start()
        try:
            yield
        finally:
            await deps.idle.stop()
            await deps.jobs.shutdown()

    app = FastAPI(title="apparatus", lifespan=lifespan)
    app.state.deps = deps
    s = deps.settings

    async def current_user(authorization: str = Header(default="")) -> str:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token:
            raise HTTPException(401, "missing bearer token")
        try:
            return await deps.auth.user_id(token)
        except AuthError as e:
            raise HTTPException(401, str(e)) from None

    # ------------------------------------------------------------------ #
    # HTTP
    # ------------------------------------------------------------------ #

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {"ok": True, "time": time.time(), "vms": len(deps.vms.links)}

    @app.post("/token")
    async def token(user_id: str = Depends(current_user)) -> dict[str, Any]:
        """An ephemeral Live token plus the exact setup message to send.

        Opening a voice session starts the VM, so it is ready for the first job.
        """
        balance, state = await deps.ledger.state(user_id)
        if state == "out":
            raise HTTPException(402, "no credits left")
        summary = await deps.sessions.summary(user_id)
        handle = await deps.sessions.resumption_handle(user_id)
        model = s.models.voice
        tok = await deps.tokens.mint(
            model=model,
            live_config=live_connect_config(s, summary, handle),
            new_session_seconds=s.live.token_new_session_seconds,
            expire_seconds=s.live.token_expire_seconds,
        )
        await deps.vm_controller.start(user_id)
        deps.jobs.touch(user_id)
        await deps.audit.record(user_id, "token.mint", model=model)
        return {
            "token": tok.name,
            "model": model,
            "setup": live_setup_message(s, model, summary, handle),
            "expires_at": tok.expire_time.astimezone(UTC).isoformat(),
            "new_session_until": tok.new_session_expire_time.astimezone(UTC).isoformat(),
            "resumption_handle": handle,
            "live": {"idle_close_seconds": s.live.idle_close_seconds},
        }

    @app.get("/credits")
    async def credits(user_id: str = Depends(current_user)) -> dict[str, Any]:
        balance, state = await deps.ledger.state(user_id)
        return {
            "balance": balance,
            "state": state,
            "history": await deps.ledger.history(user_id, 50),
        }

    @app.get("/audit")
    async def audit(
        user_id: str = Depends(current_user), limit: int = Query(200, le=1000)
    ) -> dict[str, Any]:
        return {"entries": await deps.audit.read(user_id, limit)}

    @app.get("/jobs")
    async def jobs(user_id: str = Depends(current_user)) -> dict[str, Any]:
        return {"jobs": [j.public() for j in deps.jobs.jobs.values() if j.user_id == user_id]}

    @app.get("/config/gate")
    async def gate_config() -> dict[str, Any]:
        return s.gate_dict()

    @app.get("/prompts/smart")
    async def smart_prompt(user_id: str = Depends(current_user)) -> dict[str, str]:
        return {"system": SMART_SYSTEM_PROMPT}

    # ------------------------------------------------------------------ #
    # client WebSocket
    # ------------------------------------------------------------------ #

    @app.websocket("/ws/client")
    async def ws_client(ws: WebSocket, auth: str = Query(""), device: str = Query("web")) -> None:
        try:
            user_id = await deps.auth.user_id(auth)
        except AuthError:
            await ws.close(code=4401)
            return
        await ws.accept()
        send_lock = asyncio.Lock()

        async def send(m: dict[str, Any]) -> None:
            async with send_lock:
                await ws.send_text(dumps(m))

        conn = ClientConn(user_id=user_id, device=device, send=send)
        deps.clients.attach(conn)
        try:
            balance, state = await deps.ledger.state(user_id)
            await send(
                msg(
                    S2C.READY,
                    user_id=user_id,
                    device_id=conn.device_id,
                    voice_holder=deps.clients.voice_holder.get(user_id),
                    balance=balance,
                    credits_state=state,
                    gate=s.gate_dict(),
                    live={"idle_close_seconds": s.live.idle_close_seconds},
                    jobs=[j.public() for j in deps.jobs.active_jobs(user_id)],
                )
            )
            while True:
                raw = await ws.receive_text()
                try:
                    m = parse(raw, C2S.ALL)
                except ProtocolError as e:
                    await send(msg(S2C.ERROR, code="protocol", message=str(e)))
                    continue
                deps.clients.touch(user_id)
                await handle_client_message(deps, conn, m)
        except WebSocketDisconnect:
            pass
        finally:
            deps.clients.detach(conn)

    # ------------------------------------------------------------------ #
    # agentd WebSocket
    # ------------------------------------------------------------------ #

    @app.websocket("/ws/agentd")
    async def ws_agentd(ws: WebSocket) -> None:
        await ws.accept()
        try:
            hello = parse(await ws.receive_text(), A2S.ALL)
        except (ProtocolError, WebSocketDisconnect):
            await ws.close(code=4400)
            return
        if hello["type"] != A2S.HELLO or not verify_enrollment(
            s.vm_enroll_secret, hello["vm_id"], hello["auth"]
        ):
            await ws.close(code=4403)
            return
        send_lock = asyncio.Lock()

        async def send(m: dict[str, Any]) -> None:
            async with send_lock:
                await ws.send_text(dumps(m))

        link = VmLink(hello["vm_id"], hello["user_id"], send, hello.get("capabilities"))
        deps.vms.attach(link)
        await deps.audit.record(link.user_id, "vm.connect", vm_id=link.vm_id)
        try:
            while True:
                raw = await ws.receive_text()
                try:
                    m = parse(raw, A2S.ALL)
                except ProtocolError as e:
                    log.warning("vm %s sent a bad message: %s", link.vm_id, e)
                    continue
                if m["type"] == A2S.SIGNAL:
                    await deps.clients.broadcast(
                        link.user_id,
                        msg(S2C.SIGNAL, handoff_id=m["handoff_id"], payload=m["payload"]),
                    )
                    continue
                await deps.vms.dispatch(link, m)
        except WebSocketDisconnect:
            pass
        finally:
            deps.vms.detach(link)
            await deps.audit.record(link.user_id, "vm.disconnect", vm_id=link.vm_id)

    # ------------------------------------------------------------------ #
    # static web app
    # ------------------------------------------------------------------ #

    dist = Path(s.web_dist)
    if dist.is_dir():
        app.mount("/assets", StaticFiles(directory=dist), name="assets")

        @app.get("/")
        async def index() -> FileResponse:
            return FileResponse(dist / "index.html")

        @app.get("/{name}.js")
        async def script(name: str) -> FileResponse:
            p = dist / f"{name}.js"
            if not p.is_file():
                raise HTTPException(404)
            return FileResponse(p, media_type="text/javascript")

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled error on %s", request.url.path)
        return JSONResponse({"error": "internal"}, status_code=500)

    return app


# ---------------------------------------------------------------------- #
# client messages
# ---------------------------------------------------------------------- #


async def handle_client_message(deps: Deps, conn: ClientConn, m: dict[str, Any]) -> None:
    t = m["type"]
    user_id = conn.user_id
    if t == C2S.HELLO:
        conn.device = str(m.get("device", conn.device))
        conn.wants_voice = bool(m.get("wants_voice"))
        if conn.wants_voice and user_id not in deps.clients.voice_holder:
            await deps.clients.claim_voice(conn)
    elif t == C2S.VOICE_CLAIM:
        await deps.clients.claim_voice(conn)
    elif t == C2S.VOICE_RELEASE:
        await deps.clients.release_voice(conn)
    elif t == C2S.PING:
        await conn.send(msg(S2C.PONG))
    elif t == C2S.TRANSCRIPT:
        if m.get("final", True):
            await deps.sessions.add_transcript(user_id, m["role"], m["text"])
            await deps.clients.broadcast(
                user_id,
                msg(S2C.TRANSCRIPT, role=m["role"], text=m["text"], device_id=conn.device_id),
            )
    elif t == C2S.TOOL_CALL:
        response, scheduling = await handle_voice_tool(deps, user_id, m["name"], m["args"])
        await conn.send(
            msg(
                S2C.TOOL_RESULT,
                call_id=m["call_id"],
                name=m["name"],
                response=response,
                scheduling=scheduling,
            )
        )
    elif t == C2S.HANDOFF_DONE:
        if not await deps.jobs.end_handoff(m["handoff_id"], HandoffOutcome.DONE, user_id):
            await conn.send(msg(S2C.ERROR, code="handoff", message="unknown handoff"))
    elif t == C2S.HANDOFF_CANCEL:
        await deps.jobs.end_handoff(m["handoff_id"], HandoffOutcome.CANCEL, user_id)
    elif t == C2S.APPROVAL_ANSWER:
        if not deps.jobs.answer_approval(user_id, m["approval_id"], bool(m["approved"])):
            await conn.send(msg(S2C.ERROR, code="approval", message="unknown approval"))
    elif t == C2S.LIVE_USAGE:
        await meter_live_usage(deps, user_id, m)
    elif t == C2S.LIVE_RESUMPTION:
        await deps.sessions.set_resumption_handle(user_id, m["handle"])
    elif t == C2S.LIVE_CLOSED:
        await deps.audit.record(user_id, "live.closed", reason=m.get("reason"))
    elif t == C2S.SIGNAL:
        link = deps.vms.get(user_id)
        if link is not None:
            await link.signal(m["handoff_id"], m["payload"])
    elif t == C2S.PUSH_REGISTER:
        await deps.clients.register_push(user_id, conn.device_id, m["platform"], m["token"])


async def handle_voice_tool(
    deps: Deps, user_id: str, name: str, args: dict[str, Any]
) -> tuple[dict[str, Any], str]:
    """Run one voice-model tool. Returns ``(response, scheduling)``.

    start_job returns the job id at once and stays silent: the model already
    said one sentence. check_job answers when the model is idle.
    """
    await deps.audit.record(user_id, "voice.tool", tool=name, args=args)
    if name == "start_job":
        try:
            job = await deps.jobs.start(user_id, str(args.get("request", "")), args.get("context"))
        except (InsufficientCredits, DailyCapReached) as e:
            return {"error": f"cannot start: {e}. Tell the user in one sentence."}, "INTERRUPT"
        except ValueError as e:
            return {"error": str(e)}, "WHEN_IDLE"
        return {"job_id": job.job_id, "status": "started"}, "SILENT"
    if name == "check_job":
        return deps.jobs.check(user_id, str(args.get("job_id", ""))), "WHEN_IDLE"
    if name == "cancel_job":
        return await deps.jobs.cancel(user_id, str(args.get("job_id", ""))), "WHEN_IDLE"
    if name == "show":
        content = str(args.get("content", ""))
        await deps.clients.broadcast(
            user_id, msg(S2C.SHOW, content=content, target=args.get("target"))
        )
        return {"ok": True}, "SILENT"
    return {"error": f"unknown tool {name}"}, "WHEN_IDLE"


async def meter_live_usage(deps: Deps, user_id: str, m: dict[str, Any]) -> None:
    audio_in = float(m.get("audio_in_ms", 0) or 0)
    audio_out = float(m.get("audio_out_ms", 0) or 0)
    credits = deps.ledger.price_live(audio_in, audio_out)
    if credits <= 0:
        return
    try:
        await deps.ledger.charge(
            user_id, credits, "live", audio_in_ms=audio_in, audio_out_ms=audio_out
        )
    except (InsufficientCredits, DailyCapReached):
        pass
    await deps.jobs.notify_credits(user_id)


def run() -> None:
    import uvicorn

    logging.basicConfig(level="INFO", format="%(asctime)s %(name)s %(levelname)s %(message)s")
    settings = load_settings()
    app = create_app(build_deps(settings))
    uvicorn.run(app, host=settings.host, port=settings.port, ws="websockets")


def app_from_env() -> FastAPI:
    return create_app(build_deps(load_settings()))


if __name__ == "__main__":
    run()
