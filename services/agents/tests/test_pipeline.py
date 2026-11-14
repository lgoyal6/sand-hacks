"""Pipeline test without an LLM: a scripted HTTP client stands in for the agent. Its results are test-only and
never written to data/fixtures. It checks the plumbing: register -> run -> server-side grading -> solve rates."""

import json
import socket
import subprocess
import time
from pathlib import Path

import httpx
import pytest

from unprompted_agents.attack import attack
from unprompted_agents.runners import RunOutcome
from unprompted_agents.sandbox import Sandbox
from unprompted_agents.stats import solve_rates, wilson

REPO = Path(__file__).resolve().parents[3]
QUIZ = json.loads((REPO / "apps/sandbox/quizzes/stats-101.json").read_text())


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def sandbox():
    port = _free_port()
    proc = subprocess.Popen(["node", str(REPO / "apps/sandbox/server.mjs")], env={"PATH": "/opt/homebrew/bin:/usr/bin:/bin", "SANDBOX_PORT": str(port)})
    sb = Sandbox(f"http://127.0.0.1:{port}")
    for _ in range(50):
        try:
            sb.health()
            break
        except httpx.HTTPError:
            time.sleep(0.1)
    yield sb
    proc.terminate()


def scripted_runner(answers: dict):
    def run(sb: Sandbox, run_id: str, title: str, model: str) -> RunOutcome:
        c = httpx.Client(base_url=sb.base_url, follow_redirects=False)
        c.post("/login", data={"username": "student1", "password": "sandbox", "run": run_id})
        quiz_id = QUIZ["id"]
        html = c.get(f"/quiz/{quiz_id}").text
        attempt = html.split('name="attemptId" value="')[1].split('"')[0]
        c.post(f"/quiz/{quiz_id}/submit", data={"attemptId": attempt, **answers})
        return RunOutcome(run_id, "browser-use", model, "completed", 3, 1.0)

    return run


def test_attack_grades_server_side(sandbox):
    answers = {"stats-101-q1": "b", "stats-101-q2": "b", "stats-101-q3": "1/6", "stats-101-q4": "a", "stats-101-q5": "b"}
    res = attack(QUIZ, sandbox=sandbox, repeats=2, models=["test:scripted"], runners={"browser-use": scripted_runner(answers)}, log=lambda m: None)
    assert len(res["agentRuns"]) == 10
    rates = {r["itemId"]: r for r in res["solveRates"]}
    assert rates["stats-101-q1"]["solveRate"] == 1.0 and rates["stats-101-q1"]["agentSolvable"]
    assert rates["stats-101-q4"]["solveRate"] == 0.0 and not rates["stats-101-q4"]["agentSolvable"]
    assert res["summary"]["accuracy"] == 0.8
    assert all(m["submitted"] for m in res["runs"])


def test_crashed_run_counts_as_incorrect(sandbox):
    def crash(sb, run_id, title, model):
        return RunOutcome(run_id, "browser-use", model, "error", 0, 2.0, error="boom")

    res = attack(QUIZ, sandbox=sandbox, repeats=1, models=["test:crash"], runners={"browser-use": crash}, log=lambda m: None)
    assert res["summary"]["itemCorrect"] == 0
    assert not res["runs"][0]["submitted"]


def test_refuses_remote_hosts():
    with pytest.raises(ValueError):
        Sandbox("https://canvas.example.edu")


def test_stats():
    lo, hi = wilson(9, 10)
    assert 0.55 < lo < 0.6 and 0.98 < hi <= 1.0
    rates = solve_rates([{"itemId": "a", "correct": True}, {"itemId": "a", "correct": False}], ["a", "b"])
    assert rates[0]["solveRate"] == 0.5 and not rates[0]["agentSolvable"]
    assert rates[1]["runs"] == 0
