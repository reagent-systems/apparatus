"""Credits: the source of truth for every balance (design spec, Billing).

Balances are whole credits. One credit costs ``credit_price_usd``. Usage
turns into credits as it happens, with the price table and the markup from
the config. Stripe only moves money; this ledger decides what a user can
do right now.
"""

from __future__ import annotations

import math
import time
from datetime import UTC, datetime
from typing import Any

from .config import Credits, Prices
from .store import Store

COLLECTION = "ledger"
LOG = "ledger_log"


class InsufficientCredits(RuntimeError):
    pass


class DailyCapReached(RuntimeError):
    pass


class Ledger:
    def __init__(self, store: Store, credits: Credits, prices: Prices):
        self.store = store
        self.cfg = credits
        self.prices = prices

    # ---------------------------------------------------------------- #
    # pricing
    # ---------------------------------------------------------------- #

    def usd_to_credits(self, usd: float) -> int:
        if usd <= 0:
            return 0
        # Round away float noise (0.1 * 1.5 / 0.01 = 15.000000000000002) before the ceiling.
        return math.ceil(round(usd * self.prices.markup / self.cfg.credit_price_usd, 6))

    def price_live(self, audio_in_ms: float, audio_out_ms: float) -> int:
        usd = (audio_in_ms / 60000) * self.prices.live_audio_in_usd_per_minute
        usd += (audio_out_ms / 60000) * self.prices.live_audio_out_usd_per_minute
        return self.usd_to_credits(usd)

    def price_smart(
        self, input_tokens: int, output_tokens: int, cached_tokens: int = 0, upgrade: bool = False
    ) -> int:
        if upgrade:
            pin, pout = (
                self.prices.upgrade_input_usd_per_mtok,
                self.prices.upgrade_output_usd_per_mtok,
            )
            pcache = pin / 10
        else:
            pin, pout = self.prices.smart_input_usd_per_mtok, self.prices.smart_output_usd_per_mtok
            pcache = self.prices.smart_cached_input_usd_per_mtok
        fresh = max(input_tokens - cached_tokens, 0)
        usd = fresh / 1e6 * pin + cached_tokens / 1e6 * pcache + output_tokens / 1e6 * pout
        return self.usd_to_credits(usd)

    def price_vm(self, seconds: float) -> int:
        return self.usd_to_credits(seconds / 3600 * self.prices.vm_usd_per_hour)

    # ---------------------------------------------------------------- #
    # accounts
    # ---------------------------------------------------------------- #

    async def account(self, user_id: str) -> dict[str, Any]:
        acct = await self.store.get(COLLECTION, user_id)
        if acct is None:
            acct = {
                "user_id": user_id,
                "balance": self.cfg.trial_grant,
                "holds": {},
                "spent_today": 0,
                "day": _today(),
                "grant_total": self.cfg.trial_grant,
                "low_warned": False,
                "out_warned": False,
            }
            await self.store.put(COLLECTION, user_id, acct)
            await self._log(user_id, "grant", amount=self.cfg.trial_grant, reason="trial")
        if acct.get("day") != _today():
            acct["spent_today"] = 0
            acct["day"] = _today()
            await self.store.put(COLLECTION, user_id, acct)
        return acct

    async def balance(self, user_id: str) -> int:
        return int((await self.account(user_id))["balance"])

    async def available(self, user_id: str) -> int:
        acct = await self.account(user_id)
        return int(acct["balance"]) - sum(acct["holds"].values())

    async def grant(self, user_id: str, amount: int, reason: str) -> int:
        acct = await self.account(user_id)
        acct["balance"] += int(amount)
        acct["grant_total"] += int(amount)
        acct["low_warned"] = False
        acct["out_warned"] = False
        await self.store.put(COLLECTION, user_id, acct)
        await self._log(user_id, "grant", amount=amount, reason=reason)
        return acct["balance"]

    async def monthly_grant(self, user_id: str) -> int:
        acct = await self.account(user_id)
        if not self.cfg.rollover:
            acct["balance"] = 0
            await self.store.put(COLLECTION, user_id, acct)
        return await self.grant(user_id, self.cfg.monthly_grant, "subscription")

    async def charge(self, user_id: str, amount: int, kind: str, **detail: Any) -> int:
        """Deduct ``amount`` now. Raises when the balance or the daily cap is gone."""
        amount = int(amount)
        acct = await self.account(user_id)
        if amount <= 0:
            return acct["balance"]
        if acct["spent_today"] + amount > self.cfg.daily_cap:
            raise DailyCapReached(f"daily cap of {self.cfg.daily_cap} credits reached")
        if acct["balance"] - amount < 0:
            acct["balance"] = 0
            await self.store.put(COLLECTION, user_id, acct)
            await self._log(user_id, "charge", amount=amount, usage=kind, short=True, **detail)
            raise InsufficientCredits("no credits left")
        acct["balance"] -= amount
        acct["spent_today"] += amount
        await self.store.put(COLLECTION, user_id, acct)
        await self._log(user_id, "charge", amount=amount, usage=kind, **detail)
        return acct["balance"]

    async def hold(self, user_id: str, job_id: str, amount: int | None = None) -> int:
        """Reserve a job's budget. Raises when the available balance is short."""
        amount = self.cfg.job_hold if amount is None else int(amount)
        acct = await self.account(user_id)
        available = acct["balance"] - sum(acct["holds"].values())
        if available <= 0:
            raise InsufficientCredits("no credits left")
        if acct["spent_today"] >= self.cfg.daily_cap:
            raise DailyCapReached(f"daily cap of {self.cfg.daily_cap} credits reached")
        amount = min(amount, available)
        acct["holds"][job_id] = amount
        await self.store.put(COLLECTION, user_id, acct)
        await self._log(user_id, "hold", job_id=job_id, amount=amount)
        return amount

    async def settle(self, user_id: str, job_id: str, used: int, **detail: Any) -> int:
        """Release the hold and charge what the job used. Returns the balance."""
        acct = await self.account(user_id)
        acct["holds"].pop(job_id, None)
        await self.store.put(COLLECTION, user_id, acct)
        await self._log(user_id, "settle", job_id=job_id, used=used)
        if used > 0:
            try:
                return await self.charge(user_id, used, "job", job_id=job_id, **detail)
            except (InsufficientCredits, DailyCapReached):
                return 0
        return int(acct["balance"])

    async def state(self, user_id: str) -> tuple[int, str]:
        """``(balance, state)`` where state is ok, low or out."""
        acct = await self.account(user_id)
        balance = int(acct["balance"])
        if balance <= 0:
            return balance, "out"
        floor = max(int(acct["grant_total"] * self.cfg.low_balance_fraction), 1)
        return balance, ("low" if balance <= floor else "ok")

    async def warn_once(self, user_id: str, state: str) -> bool:
        """True the first time ``state`` (low or out) is seen since the last grant."""
        acct = await self.account(user_id)
        key = {"low": "low_warned", "out": "out_warned"}.get(state)
        if key is None or acct.get(key):
            return False
        acct[key] = True
        await self.store.put(COLLECTION, user_id, acct)
        return True

    async def history(self, user_id: str, limit: int = 200) -> list[dict[str, Any]]:
        return (await self.store.entries(LOG, user_id))[-limit:]

    async def _log(self, user_id: str, kind: str, **fields: Any) -> None:
        await self.store.append(LOG, user_id, {"t": round(time.time(), 3), "kind": kind, **fields})


def _today() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d")
