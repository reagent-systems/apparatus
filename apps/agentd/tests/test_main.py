from agentd.main import Agentd, enrollment_auth


def test_enrollment_auth_is_deterministic_hmac():
    a = enrollment_auth("secret", "vm-1")
    assert a == enrollment_auth("secret", "vm-1")
    assert a != enrollment_auth("secret", "vm-2")
    assert a != enrollment_auth("other", "vm-1")
    assert len(a) == 64


def test_hello_shape(cfg):
    d = Agentd(cfg)
    h = d.hello()
    assert h["type"] == "hello"
    assert h["vm_id"] == "local" and h["user_id"] == "dev"
    assert h["auth"] == enrollment_auth("s3cret", "local")
    assert h["capabilities"]["desktop"] is False
