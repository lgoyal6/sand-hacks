"""Client for the sandbox runner API (apps/sandbox). Only ever talks to our own sandbox."""

from __future__ import annotations

import os
from urllib.parse import urlparse

import httpx

LOCAL_HOSTS = {"localhost", "127.0.0.1"}


class Sandbox:
    def __init__(self, base_url: str | None = None, token: str | None = None):
        self.base_url = (base_url or os.environ.get("SANDBOX_URL") or "http://localhost:3101").rstrip("/")
        host = urlparse(self.base_url).hostname
        if host not in LOCAL_HOSTS and not os.environ.get("SANDBOX_ALLOW_REMOTE"):
            # Guard rail from the build plan: agents attack our own sandboxes, never real courses.
            raise ValueError(f"refusing to attack non-local host {host!r}; set SANDBOX_ALLOW_REMOTE=1 for our own deploy")
        self.token = token or os.environ.get("SANDBOX_RUNNER_TOKEN") or "dev-runner-token"
        self.http = httpx.Client(base_url=self.base_url, headers={"x-runner-token": self.token}, timeout=30)

    @property
    def netloc(self) -> str:
        return urlparse(self.base_url).netloc

    def health(self) -> dict:
        return self.http.get("/api/health").raise_for_status().json()

    def register(self, quiz: dict) -> str:
        r = self.http.post("/api/quizzes", json=quiz)
        r.raise_for_status()
        return r.json()["url"]

    def run_results(self, run_id: str) -> list[dict]:
        return self.http.get(f"/api/runs/{run_id}").raise_for_status().json()["attempts"]

    def login_url(self, run_id: str) -> str:
        return f"{self.base_url}/login?run={run_id}"
