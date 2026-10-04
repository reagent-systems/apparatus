"""agentd settings. All from the environment; no secrets beyond the VM identity."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AgentdConfig:
    server_url: str
    vm_id: str
    user_id: str
    enroll_secret: str
    home: Path
    socket_path: Path
    desktop: str  # "fake" | "xdo"
    display: str
    python_timeout_seconds: float
    desktop_lock_wait_seconds: float
    kernel_user: str | None
    max_output_chars: int
    reconnect_min_seconds: float
    reconnect_max_seconds: float

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> AgentdConfig:
        e = os.environ if env is None else env
        home = Path(e.get("AGENTD_HOME", "/home/agent"))
        secret = e.get("APPARATUS_VM_ENROLL_SECRET", "")
        secret_file = e.get("APPARATUS_VM_ENROLL_SECRET_FILE")
        if secret_file:
            secret = Path(secret_file).read_text().strip()
        return cls(
            server_url=e.get("AGENTD_SERVER_URL", "ws://localhost:8080/ws/agentd"),
            vm_id=e.get("AGENTD_VM_ID", "local"),
            user_id=e.get("AGENTD_USER_ID", "dev"),
            enroll_secret=secret,
            home=home,
            socket_path=Path(e.get("AGENTD_SOCKET", str(home / ".agentd.sock"))),
            desktop=e.get("AGENTD_DESKTOP", "fake"),
            display=e.get("DISPLAY", ":0"),
            python_timeout_seconds=float(e.get("AGENTD_PYTHON_TIMEOUT_SECONDS", "120")),
            desktop_lock_wait_seconds=float(e.get("AGENTD_DESKTOP_LOCK_WAIT_SECONDS", "5")),
            kernel_user=e.get("AGENTD_KERNEL_USER") or None,
            max_output_chars=int(e.get("AGENTD_MAX_OUTPUT_CHARS", "50000")),
            reconnect_min_seconds=float(e.get("AGENTD_RECONNECT_MIN_SECONDS", "1")),
            reconnect_max_seconds=float(e.get("AGENTD_RECONNECT_MAX_SECONDS", "30")),
        )
