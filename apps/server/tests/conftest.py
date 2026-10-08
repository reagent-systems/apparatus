import pytest

from apparatus_server.config import load_settings


@pytest.fixture
def settings(tmp_path):
    return load_settings(
        {
            "APPARATUS_CONFIG": "config/apparatus.toml",
            "APPARATUS_STORE": "memory",
            "APPARATUS_AUTH_MODE": "dev",
            "APPARATUS_VM_ENROLL_SECRET": "",
            "APPARATUS_WEB_DIST": str(tmp_path / "no-dist"),
        }
    )
