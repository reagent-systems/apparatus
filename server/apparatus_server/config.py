"""Server settings: the one TOML file plus a few environment values.

``config/apparatus.toml`` holds every model name, threshold, budget and
price. The environment holds only deployment facts and the API key. A
missing or damaged TOML never crashes the server: defaults apply and one
log line says so.
"""

from __future__ import annotations

import logging
import os
import tomllib
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Any

log = logging.getLogger("apparatus.config")


@dataclass(frozen=True)
class Models:
    voice: str = "gemini-3.8-live"
    voice_premium: str = "gemini-3.8-live-extended-thinking"
    smart: str = "gemini-3.8-flash"
    smart_upgrade: str = "gemini-3.1-pro-preview"
    smart_use_upgrade: bool = False


@dataclass(frozen=True)
class Live:
    token_new_session_seconds: int = 60
    token_expire_seconds: int = 1800
    idle_close_seconds: int = 120
    input_sample_rate: int = 16000
    output_sample_rate: int = 24000
    automatic_activity_detection: bool = False
    session_resumption: bool = True
    context_window_compression: bool = True
    summary_max_chars: int = 2000


@dataclass(frozen=True)
class Gate:
    vad_energy_threshold: float = 0.015
    vad_hangover_ms: int = 240
    min_speech_ms: int = 300
    silence_complete_ms: int = 500
    silence_incomplete_ms: int = 2500
    bargein_min_voice_ms: int = 300
    bargein_min_words: int = 2
    bargein_stop_ms: int = 200
    speaker_check: bool = False
    speaker_match_threshold: float = 0.75


@dataclass(frozen=True)
class Jobs:
    max_steps: int = 40
    max_tokens: int = 400_000
    max_wall_seconds: int = 900
    context_summary_chars: int = 60_000
    context_keep_steps: int = 6
    python_timeout_seconds: int = 120
    handoff_wait_minutes: int = 30
    approval_wait_minutes: int = 30


@dataclass(frozen=True)
class Vm:
    idle_stop_minutes: int = 30
    desktop_lock_wait_seconds: int = 5
    disk_home: str = "/home/agent"


@dataclass(frozen=True)
class Stream:
    stun_url: str = "stun:stun.l.google.com:19302"
    turn_ttl_seconds: int = 3600
    fps: int = 12
    width: int = 1280
    height: int = 800


@dataclass(frozen=True)
class Credits:
    credit_price_usd: float = 0.01
    trial_grant: int = 500
    monthly_grant: int = 3000
    rollover: bool = False
    daily_cap: int = 1500
    low_balance_fraction: float = 0.20
    job_hold: int = 100


@dataclass(frozen=True)
class Prices:
    live_audio_in_usd_per_minute: float = 0.005
    live_audio_out_usd_per_minute: float = 0.018
    smart_input_usd_per_mtok: float = 0.75
    smart_output_usd_per_mtok: float = 3.75
    smart_cached_input_usd_per_mtok: float = 0.075
    upgrade_input_usd_per_mtok: float = 2.0
    upgrade_output_usd_per_mtok: float = 12.0
    vm_usd_per_hour: float = 0.10
    disk_usd_per_month: float = 2.0
    markup: float = 1.5


@dataclass(frozen=True)
class Settings:
    models: Models = field(default_factory=Models)
    live: Live = field(default_factory=Live)
    gate: Gate = field(default_factory=Gate)
    jobs: Jobs = field(default_factory=Jobs)
    vm: Vm = field(default_factory=Vm)
    stream: Stream = field(default_factory=Stream)
    credits: Credits = field(default_factory=Credits)
    prices: Prices = field(default_factory=Prices)

    # Environment-only values. Never in the TOML.
    gemini_api_key: str = ""
    host: str = "0.0.0.0"
    port: int = 8080
    auth_mode: str = "dev"  # dev | firebase
    firebase_project_id: str = ""
    store: str = "memory"  # memory | file
    data_dir: str = "data"
    vm_enroll_secret: str = ""
    vm_controller: str = "local"  # local | gce
    gce_project: str = ""
    gce_zone: str = ""
    push: str = "log"  # log | fcm
    web_dist: str = "web/dist"
    turn_url: str = ""  # empty: no TURN relay, STUN only
    turn_secret: str = ""  # coturn use-auth-secret
    demo: bool = False  # scripted smart model, no key needed
    config_path: str = "config/apparatus.toml"

    def gate_dict(self) -> dict[str, Any]:
        return asdict(self.gate)


_SECTIONS = {
    "models": Models,
    "live": Live,
    "gate": Gate,
    "jobs": Jobs,
    "vm": Vm,
    "stream": Stream,
    "credits": Credits,
    "prices": Prices,
}


def _section(cls: type, raw: Any, name: str) -> Any:
    if not isinstance(raw, dict):
        if raw is not None:
            log.warning("config [%s] is not a table; defaults apply", name)
        return cls()
    known = {f.name: f.type for f in fields(cls)}
    values = {}
    for k, v in raw.items():
        if k not in known:
            log.warning("config [%s].%s is unknown; ignored", name, k)
            continue
        values[k] = v
    try:
        return cls(**values)
    except TypeError as e:
        log.warning("config [%s] rejected (%s); defaults apply", name, e)
        return cls()


def load_toml(path: str | Path) -> dict[str, Any]:
    p = Path(path)
    try:
        with p.open("rb") as f:
            return tomllib.load(f)
    except FileNotFoundError:
        log.warning("config file %s not found; defaults apply", p)
    except tomllib.TOMLDecodeError as e:
        log.warning("config file %s is damaged (%s); defaults apply", p, e)
    return {}


def load_settings(env: dict[str, str] | None = None) -> Settings:
    e = os.environ if env is None else env
    config_path = e.get("APPARATUS_CONFIG", "config/apparatus.toml")
    raw = load_toml(config_path)
    sections = {name: _section(cls, raw.get(name), name) for name, cls in _SECTIONS.items()}
    for name in raw:
        if name not in _SECTIONS:
            log.warning("config table [%s] is unknown; ignored", name)
    return Settings(
        **sections,
        gemini_api_key=e.get("GEMINI_API_KEY", ""),
        host=e.get("APPARATUS_HOST", "0.0.0.0"),
        port=int(e.get("APPARATUS_PORT", "8080")),
        auth_mode=e.get("APPARATUS_AUTH_MODE", "dev"),
        firebase_project_id=e.get("FIREBASE_PROJECT_ID", ""),
        store=e.get("APPARATUS_STORE", "memory"),
        data_dir=e.get("APPARATUS_DATA_DIR", "data"),
        vm_enroll_secret=e.get("APPARATUS_VM_ENROLL_SECRET", ""),
        vm_controller=e.get("APPARATUS_VM_CONTROLLER", "local"),
        gce_project=e.get("GCE_PROJECT", ""),
        gce_zone=e.get("GCE_ZONE", ""),
        push=e.get("APPARATUS_PUSH", "log"),
        web_dist=e.get("APPARATUS_WEB_DIST", "web/dist"),
        turn_url=e.get("APPARATUS_TURN_URL", ""),
        turn_secret=e.get("APPARATUS_TURN_SECRET", ""),
        demo=e.get("APPARATUS_DEMO", "") == "1",
        config_path=config_path,
    )
