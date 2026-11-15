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
QUIZ = json.loads((REPO / "apps/sandbox/quizzes/sample-stats.json").read_text())


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
    answers = {"sample-stats-q1": "b", "sample-stats-q2": "b", "sample-stats-q3": "1/6", "sample-stats-q4": "a", "sample-stats-q5": "b"}
    res = attack(QUIZ, sandbox=sandbox, repeats=2, models=["test:scripted"], runners={"browser-use": scripted_runner(answers)}, log=lambda m: None)
    assert len(res["agentRuns"]) == 10
    rates = {r["itemId"]: r for r in res["solveRates"]}
    assert rates["sample-stats-q1"]["solveRate"] == 1.0 and rates["sample-stats-q1"]["agentSolvable"]
    assert rates["sample-stats-q4"]["solveRate"] == 0.0 and not rates["sample-stats-q4"]["agentSolvable"]
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


def test_provider_errors_are_excluded(sandbox):
    def quota(sb, run_id, title, model):
        return RunOutcome(run_id, "browser-use", model, "error", 1, 1.0, error="ModelRateLimitError: status_code: 429")

    res = attack(QUIZ, sandbox=sandbox, repeats=1, models=["test:quota"], runners={"browser-use": quota}, log=lambda m: None)
    assert res["agentRuns"] == [] and res["summary"]["infraErrors"] == 1
    assert res["solveRates"][0]["runs"] == 0


@pytest.mark.skipif(not (REPO / "services/agents/node_modules/@browserbasehq/stagehand").exists(), reason="pnpm install")
def test_stagehand_dry_run_logs_in_and_opens_quiz(sandbox):
    """Real local browser, no model: checks Stagehand launch, login and quiz navigation."""
    from unprompted_agents.runners import run_stagehand

    out = run_stagehand(sandbox, "run-dry", QUIZ["title"], "gemini:unused", dry_run=True, timeout=120)
    assert out.status == "completed", out.error
    assert out.steps == 0  # no model calls
    assert any(e["kind"] == "dry-run" and e["questions"] == 5 for e in out.trace)


def test_runtime_results_mapping_and_stuck_at_probe():
    """C's GET /api/attempts shape -> AgentRun[]; an unfinished attempt with a probe open is flagged stuck."""
    from unprompted_agents.attack import to_agent_runs
    from unprompted_agents.sandbox import Runtime

    payload = {"attempts": [{
        "attemptId": "att_1", "quizId": "sample-stats", "mode": "graded", "startedAt": "2026-11-14T10:00:00Z",
        "finishedAt": None, "userAgent": "x", "probesTriggered": ["sample-stats-q2"],
        "responses": [
            {"itemId": "sample-stats-q1", "correct": True, "seconds": 4.2, "answeredAt": "2026-11-14T10:00:05Z"},
            {"itemId": "sample-stats-q2", "correct": True, "seconds": 3.1, "answeredAt": "2026-11-14T10:00:09Z"},
        ],
    }]}

    def handler(req: httpx.Request):
        assert req.headers["x-runner-token"] and req.url.params["student"] == "agent-run-1"
        return httpx.Response(200, json=payload)

    rt = Runtime("http://localhost:3100")
    rt.http = httpx.Client(base_url=rt.base_url, transport=httpx.MockTransport(handler), headers=rt.http.headers)
    rt.item_ids = [f"sample-stats-q{i}" for i in range(1, 6)]
    attempts = rt.run_results("run-1")
    outcome = RunOutcome("run-1", "browser-use", "gemini:x", "max_steps", 40, 300.0)
    runs, meta = to_agent_runs({"id": "sample-stats"}, outcome, attempts, rt.item_ids)
    assert [r["correct"] for r in runs] == [True, True, False, False, False]
    assert runs[0]["seconds"] == 4.2
    assert meta["target"] == "runtime" and meta["stuckAtProbe"] is True


def test_parse_all_quiz_markdown():
    from unprompted_agents.quiz_md import parse_quiz_md

    for md in sorted((REPO / "data/quizzes").glob("*.md")):
        q = parse_quiz_md(md)
        assert q["id"] == md.stem and q["items"], md.name
        for i, it in enumerate(q["items"], 1):
            assert it["id"] == f"{md.stem}-q{i}" and it["objective"], it["id"]
    s = parse_quiz_md(REPO / "data/quizzes/sample-stats.md")
    assert [i["answerKey"] for i in s["items"]] == [i["answerKey"] for i in QUIZ["items"]]
    e = parse_quiz_md(REPO / "data/quizzes/econ-micro.md")
    assert next(i for i in e["items"] if i["type"] == "multi")["answerKey"] == ["a", "c", "d"]


def test_per_model_repeat_override(sandbox):
    seen = []

    def rec(sb, run_id, title, model):
        seen.append(model)
        return RunOutcome(run_id, "browser-use", model, "error", 0, 0.1, error="boom")

    attack(QUIZ, sandbox=sandbox, repeats=2, models=["a:x", "b:y@1"], runners={"browser-use": rec}, log=lambda m: None)
    assert seen == ["a:x", "a:x", "b:y"]
