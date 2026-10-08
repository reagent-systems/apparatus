"""Who is calling. ``dev`` trusts the token as a user id. ``firebase``
verifies an Identity Platform ID token (RS256, Google's public certs)."""

from __future__ import annotations

import time
from typing import Any, Protocol

import httpx
import jwt

GOOGLE_CERTS = (
    "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
)


class AuthError(Exception):
    pass


class Authenticator(Protocol):
    async def user_id(self, token: str) -> str: ...


class DevAuthenticator:
    """Development only. The token is the user id."""

    async def user_id(self, token: str) -> str:
        token = (token or "").strip()
        if not token or len(token) > 64 or not all(c.isalnum() or c in "-_@." for c in token):
            raise AuthError("bad dev token")
        return token


class FirebaseAuthenticator:
    def __init__(self, project_id: str, client: httpx.AsyncClient | None = None):
        if not project_id:
            raise ValueError("firebase auth needs FIREBASE_PROJECT_ID")
        self.project_id = project_id
        self.client = client or httpx.AsyncClient(timeout=10)
        self._certs: dict[str, Any] = {}
        self._certs_until = 0.0

    async def _public_key(self, kid: str) -> Any:
        if time.time() > self._certs_until or kid not in self._certs:
            r = await self.client.get(GOOGLE_CERTS)
            r.raise_for_status()
            self._certs = r.json()
            max_age = 3600
            cc = r.headers.get("cache-control", "")
            for part in cc.split(","):
                part = part.strip()
                if part.startswith("max-age="):
                    try:
                        max_age = int(part[8:])
                    except ValueError:
                        pass
            self._certs_until = time.time() + max_age
        pem = self._certs.get(kid)
        if pem is None:
            raise AuthError("unknown key id")
        from cryptography import x509

        cert = x509.load_pem_x509_certificate(pem.encode())
        return cert.public_key()

    async def user_id(self, token: str) -> str:
        try:
            header = jwt.get_unverified_header(token)
            key = await self._public_key(header.get("kid", ""))
            claims = jwt.decode(
                token,
                key=key,
                algorithms=["RS256"],
                audience=self.project_id,
                issuer=f"https://securetoken.google.com/{self.project_id}",
            )
        except (jwt.PyJWTError, httpx.HTTPError, ValueError) as e:
            raise AuthError(f"invalid id token: {e}") from None
        sub = claims.get("sub")
        if not sub:
            raise AuthError("id token without subject")
        return str(sub)


def make_authenticator(mode: str, firebase_project_id: str) -> Authenticator:
    if mode == "dev":
        return DevAuthenticator()
    if mode == "firebase":
        return FirebaseAuthenticator(firebase_project_id)
    raise ValueError(f"unknown auth mode {mode!r}")
