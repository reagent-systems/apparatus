import pytest

from agentd.config import AgentdConfig


@pytest.fixture
def cfg(tmp_path):
    home = tmp_path / "home"
    return AgentdConfig.from_env(
        {
            "AGENTD_HOME": str(home),
            "AGENTD_SOCKET": str(tmp_path / "a.sock"),
            "AGENTD_DESKTOP": "fake",
            "AGENTD_PYTHON_TIMEOUT_SECONDS": "10",
            "AGENTD_DESKTOP_LOCK_WAIT_SECONDS": "0.2",
            "APPARATUS_VM_ENROLL_SECRET": "s3cret",
        }
    )
