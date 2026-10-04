import pytest

from apparatus_server.config import Credits, Prices
from apparatus_server.ledger import DailyCapReached, InsufficientCredits, Ledger
from apparatus_server.store import MemoryStore


@pytest.fixture
def ledger():
    return Ledger(
        MemoryStore(),
        Credits(trial_grant=100, daily_cap=80, job_hold=30, low_balance_fraction=0.2),
        Prices(),
    )


async def test_trial_grant_and_pricing(ledger):
    assert await ledger.balance("u") == 100
    # 1 minute in + 1 minute out = $0.023 * 1.5 markup / $0.01 = 3.45 -> 4 credits
    assert ledger.price_live(60000, 60000) == 4
    # 1M input + 100k output on flash: 0.75 + 0.375 = $1.125 * 1.5 / 0.01 = 168.75 -> 169
    assert ledger.price_smart(1_000_000, 100_000) == 169
    # cached input is cheaper
    assert ledger.price_smart(1_000_000, 0, cached_tokens=1_000_000) < ledger.price_smart(
        1_000_000, 0
    )
    assert ledger.price_vm(3600) == 15
    assert ledger.usd_to_credits(0) == 0


async def test_hold_and_settle_return_unused_part(ledger):
    held = await ledger.hold("u", "j1")
    assert held == 30
    assert await ledger.available("u") == 70
    balance = await ledger.settle("u", "j1", used=12)
    assert balance == 88
    assert await ledger.available("u") == 88


async def test_charge_stops_at_zero_and_daily_cap(ledger):
    await ledger.charge("u", 50, "live")
    with pytest.raises(DailyCapReached):
        await ledger.charge("u", 40, "live")  # 90 > cap 80
    await ledger.charge("u", 30, "live")  # 80 == cap, allowed
    acct = await ledger.account("u")
    assert acct["balance"] == 20
    other = Ledger(MemoryStore(), Credits(trial_grant=10, daily_cap=1000), Prices())
    with pytest.raises(InsufficientCredits):
        await other.charge("v", 11, "job")
    assert await other.balance("v") == 0
    with pytest.raises(InsufficientCredits):
        await other.hold("v", "j")


async def test_state_and_warn_once(ledger):
    assert await ledger.state("u") == (100, "ok")
    await ledger.charge("u", 79, "live")
    assert await ledger.state("u") == (21, "ok")
    await ledger.charge("u", 1, "live")
    assert await ledger.state("u") == (20, "low")
    assert await ledger.warn_once("u", "low") is True
    assert await ledger.warn_once("u", "low") is False
    await ledger.grant("u", 100, "topup")
    assert await ledger.warn_once("u", "low") is True  # reset by the grant
    rows = await ledger.history("u")
    assert [r["kind"] for r in rows][:2] == ["grant", "charge"]


async def test_monthly_grant_without_rollover_resets_balance(ledger):
    await ledger.charge("u", 10, "live")
    assert await ledger.monthly_grant("u") == 3000
