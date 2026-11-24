"""GitHub App authentication: JWT signing, installation tokens, automatic renewal and the Tokens API."""

import asyncio
import time

import httpx
import jwt
import pytest
import respx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.github_app import GitHubAppAuth, GitHubAppError
from tests.test_api import GH, client  # noqa: F401  (reuse the API fixture)

KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PEM = KEY.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                        serialization.NoEncryption()).decode()
PUBLIC = KEY.public_key()


def expires_in(seconds: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + seconds))


def mock_app(mock, token="ghs_installation1", expires=3600, calls=None):
    def access_tokens(request):
        claims = jwt.decode(request.headers["authorization"].removeprefix("Bearer "), PUBLIC, algorithms=["RS256"])
        assert claims["iss"] == "123"
        if calls is not None:
            calls.append(1)
        return httpx.Response(201, json={"token": f"{token}-{len(calls or [])}", "expires_at": expires_in(expires)})

    mock.get("/app").respond(json={"name": "Profile Finder"})
    mock.get("/app/installations").respond(json=[{"id": 777, "account": {"login": "my-org"}}])
    mock.post("/app/installations/777/access_tokens").mock(side_effect=access_tokens)


def test_installation_token_is_created_cached_and_renewed():
    calls = []
    with respx.mock(base_url=GH) as mock:
        mock_app(mock, expires=3600, calls=calls)

        async def run():
            auth = GitHubAppAuth("123", PEM)
            first = await auth.token()
            assert await auth.token() == first  # cached while far from expiry
            assert auth.installation_id == "777" and auth.account == "my-org" and auth.app_name == "Profile Finder"
            auth._expires_at = time.time() + 60  # about to expire
            assert auth.needs_renewal()
            assert await auth.token() != first
            return first

        assert asyncio.run(run()) == "ghs_installation1-1"
    assert len(calls) == 2


def test_bad_credentials_are_reported():
    with respx.mock(base_url=GH) as mock:
        mock.get("/app").respond(401, json={"message": "A JSON web token could not be decoded"})
        with pytest.raises(GitHubAppError, match="rejected the App ID or private key"):
            asyncio.run(GitHubAppAuth("123", PEM).token())
    with pytest.raises(GitHubAppError, match="private key"):
        asyncio.run(GitHubAppAuth("123", "not a key").token())


def test_setup_through_api_activates_app_and_lists_its_limit(client, tmp_path):  # noqa: F811
    mock_app(client.mock)
    client.mock.get("/rate_limit").mock(side_effect=lambda req: httpx.Response(200, json={"resources": {
        "core": {"limit": 12500 if "ghs_" in req.headers["authorization"] else 5000, "remaining": 12000,
                 "reset": 1900000000},
        "search": {"limit": 30, "remaining": 30, "reset": 1900000000}}}))
    # Installation tokens can't read /user (403), but the response still carries the real quota.
    client.mock.get("/user").mock(side_effect=lambda req: httpx.Response(403, headers={
        "x-ratelimit-limit": "12500" if "ghs_" in req.headers["authorization"] else "5000",
        "x-ratelimit-remaining": "12000", "x-ratelimit-reset": "1900000000", "x-ratelimit-resource": "core"}))

    assert client.put("/api/github-app", json={"app_id": "123", "private_key": "x" * 120}).status_code == 400
    r = client.put("/api/github-app", json={"app_id": "123", "private_key": PEM})
    assert r.status_code == 200, r.text
    assert r.json()["configured"] and r.json()["active"] and r.json()["installation_id"] == "777"
    assert client.app.state.gh._client.headers["Authorization"] == "Bearer ghs_installation1-0"

    listed = client.get("/api/tokens").json()
    app_entry = next(t for t in listed if t["id"] == "github-app")
    assert app_entry["active"] and app_entry["core"]["limit"] == 12500 and app_entry["login"] == "my-org"
    assert "ghs_" not in str(listed) and "PRIVATE KEY" not in str(listed)
    assert "PRIVATE KEY" in (tmp_path / "github_app.json").read_text()

    # Removing the app falls back to the .env token.
    assert client.delete("/api/github-app").json()["active"] == "env"
    assert client.app.state.gh._client.headers["Authorization"] == "Bearer test-token"
    assert not (tmp_path / "github_app.json").exists()
