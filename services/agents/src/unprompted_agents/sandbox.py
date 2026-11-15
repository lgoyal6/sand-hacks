"""Client for the sandbox runner API (apps/sandbox). Only ever talks to our own sandbox."""

from __future__ import annotations

import os
from urllib.parse import quote, urlparse

import httpx

LOCAL_HOSTS = {"localhost", "127.0.0.1"}


class Sandbox:
    """Target: apps/sandbox (:3101), the minimal LMS-like quiz site."""

    kind = "sandbox"
    quiz_id: str | None = None  # set by attack(); the agent is sent straight to this quiz, never asked to find it by title

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

    def task(self, run_id: str, quiz_title: str) -> str:
        # Phrased the way a student would ask an agent to do their quiz. No hints about answers.
        return (
            f"Go to {self.login_url(run_id)} and log in with username student1 and password sandbox. "
            + (f"Then open {self.base_url}/quiz/{quote(self.quiz_id)} (the quiz \"{quiz_title}\"). " if self.quiz_id
               else f'Open the quiz titled "{quiz_title}". ')
            + 'Answer every question as correctly as you can, then press "Submit quiz". '
            + 'You are done when the page says "Quiz submitted".'
        )


class Runtime(Sandbox):
    """Target: C's real student runtime in apps/web (:3100), with telemetry and think-aloud probes on.

    Attempts are tagged with ?student=agent-<runId> and read back from C's token-guarded GET /api/attempts?student=.
    Runs here are the agent class of D's training data, so the agent is run plainly: no detection evasion.
    """

    kind = "runtime"

    def __init__(self, base_url: str | None = None, token: str | None = None):
        super().__init__(base_url or os.environ.get("RUNTIME_URL") or "http://localhost:3100", token)

    def register(self, quiz: dict) -> str:
        # The runtime serves its own quizzes; we can only attack ones it already has (no variant registration yet).
        r = self.http.get(f"/quiz/{quiz['id']}")
        # Pages need a session (Neon Auth), so an unauthenticated check is redirected to /signin: that's fine.
        signin = r.is_redirect and "/signin" in r.headers.get("location", "")
        if r.status_code != 200 and not signin:
            raise ValueError(f"runtime has no quiz {quiz['id']!r} (HTTP {r.status_code})")
        return self.start_url("check")

    def start_url(self, run_id: str) -> str:
        # RUNTIME_VOICE_REQUIRED=1: graded think-alouds offer only voice or an accommodation request (C's flag).
        voice = "&voice=required" if os.environ.get("RUNTIME_VOICE_REQUIRED") == "1" else ""
        return f"{self.base_url}/quiz/{self.quiz_id}?mode=graded{voice}&student=agent-{run_id}"

    def task(self, run_id: str, quiz_title: str) -> str:
        # Pages need a session (Neon Auth). The demo student needs no password; ?student=agent-... still tags the run.
        return (
            f"Go to {self.base_url}/signin and sign in with the demo student account. Then go to "
            f"{self.start_url(run_id)} and take the graded quiz. Press \"Start graded quiz\", answer every "
            "question as correctly as you can, and complete anything the page asks of you along the way, until the quiz "
            "is submitted and your results are shown."
        )

    def run_results(self, run_id: str) -> list[dict]:
        """C's attempts -> the sandbox's result shape that attack.to_agent_runs reads."""
        r = self.http.get("/api/attempts", params={"student": f"agent-{run_id}"}).raise_for_status().json()
        out = []
        for a in r.get("attempts", []):
            got = {x["itemId"]: x for x in a.get("responses", [])}
            out.append({
                "attemptId": a["attemptId"],
                "quizId": a["quizId"],
                "startedAt": a["startedAt"],
                # Submitted = finished. Responses on an unfinished attempt are reported as answered-not-submitted.
                "submittedAt": a.get("finishedAt"),
                "finished": bool(a.get("finishedAt")),
                "probesTriggered": a.get("probesTriggered", []),
                "userAgent": a.get("userAgent"),
                "items": [
                    {"itemId": i, "answered": i in got, "correct": bool(got.get(i, {}).get("correct")),
                     "seconds": got.get(i, {}).get("seconds"), "answerChanges": None}
                    for i in self.item_ids
                ],
            })
        return out

    item_ids: list[str] = []
