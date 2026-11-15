"""Agent runners. Each takes the quiz the way a student's agent would: log in, open the quiz, answer, submit.

The runner never tells the agent the answers and never grades from the agent's own report; correctness comes from
the sandbox's server-side grading (Sandbox.run_results).
"""

from __future__ import annotations

import json
import os
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from .sandbox import Sandbox

GMI_BASE_URL = os.environ.get("GMI_BASE_URL", "https://api.gmi-serving.com/v1")


def task_prompt(sandbox: Sandbox, run_id: str, quiz_title: str) -> str:
    # Phrased the way a student would ask an agent to do their quiz. No hints about answers.
    return (
        f"Go to {sandbox.login_url(run_id)} and log in with username student1 and password sandbox. "
        f'Open the quiz titled "{quiz_title}". Answer every question as correctly as you can, then press '
        '"Submit quiz". You are done when the page says "Quiz submitted".'
    )


@dataclass
class RunOutcome:
    run_id: str
    agent: str
    model: str
    status: str  # completed | timeout | max_steps | error
    steps: int
    seconds: float
    error: str | None = None
    cost_usd: float | None = None
    trace: list[dict] = field(default_factory=list)


def make_llm(model: str):
    """'gemini:<id>' -> Gemini, 'gmi:<id>' -> GMI Cloud (OpenAI-compatible), anything else -> Pydantic AI string."""
    provider, _, name = model.partition(":")
    if provider == "gemini":
        from browser_use import ChatGoogle

        key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if not key:
            raise RuntimeError("GEMINI_API_KEY is not set (.env.local)")
        return ChatGoogle(name, api_key=key)
    if provider == "gmi":
        from browser_use import ChatOpenAI

        key = os.environ.get("GMI_API_KEY")
        if not key:
            raise RuntimeError("GMI_API_KEY is not set (.env.local)")
        return ChatOpenAI(name, api_key=key, base_url=GMI_BASE_URL)
    return model


def _light_trace(messages) -> list[dict]:
    """Keep the code cells the agent ran and short tool results; drop screenshots. Small enough for a demo replay."""
    out: list[dict] = []
    for msg in messages or []:
        for part in getattr(msg, "parts", []):
            kind = getattr(part, "part_kind", "")
            if kind == "tool-call":
                args = part.args if isinstance(part.args, dict) else _safe_json(part.args)
                out.append({"kind": "call", "tool": part.tool_name, "args": _clip(args, 2000)})
            elif kind == "tool-return":
                out.append({"kind": "result", "tool": part.tool_name, "content": _clip(part.content, 600)})
            elif kind == "text":
                out.append({"kind": "text", "content": _clip(part.content, 600)})
    return out


def _safe_json(s):
    try:
        return json.loads(s)
    except Exception:
        return s


def _clip(v, n):
    if isinstance(v, str):
        return v if len(v) <= n else v[:n] + f"... ({len(v)} chars)"
    if isinstance(v, dict):
        return {k: _clip(x, n) for k, x in v.items()}
    if isinstance(v, list):
        return [_clip(x, n) for x in v[:20]]
    if isinstance(v, (int, float, bool)) or v is None:
        return v
    return _clip(str(v), n)


def run_browser_use(sandbox: Sandbox, run_id: str, quiz_title: str, model: str, *, headless: bool = True,
                    max_steps: int = 40, timeout: float = 600) -> RunOutcome:
    from browser_use import Agent, Browser

    # Local Chromium only (1.0 defaults to a cloud browser), locked to the sandbox host.
    browser = Browser("chromium", headless=headless, allowed_domains=[sandbox.netloc])
    workspace = tempfile.mkdtemp(prefix="unprompted-bu-")
    agent = Agent(task_prompt(sandbox, run_id, quiz_title), llm=make_llm(model), browser=browser, workspace=workspace)
    t0 = time.monotonic()
    try:
        result = agent.run_sync(max_steps=max_steps, timeout=timeout)
    except Exception as e:  # a crashed run still counts: every item is scored incorrect
        return RunOutcome(run_id, "browser-use", model, "error", 0, time.monotonic() - t0, error=repr(e)[:500])
    return RunOutcome(
        run_id,
        "browser-use",
        model,
        result.status,
        result.steps,
        result.duration_s,
        error=result.error,
        cost_usd=result.cost_usd,
        trace=_light_trace(result.messages),
    )


STAGEHAND_SCRIPT = Path(__file__).resolve().parents[2] / "stagehand" / "run.mjs"


def stagehand_model(model: str) -> str:
    provider, _, name = model.partition(":")
    if provider == "gemini":
        return f"google/{name}"
    raise ValueError(f"stagehand runner supports gemini:<id> models only, not {model!r}")


def run_stagehand(sandbox: Sandbox, run_id: str, quiz_title: str, model: str, *, headless: bool = True,
                  timeout: float = 600, dry_run: bool = False) -> RunOutcome:
    """Runs stagehand/run.mjs (Node) and reads its JSON result from the last stdout line."""
    import subprocess

    payload = {"loginUrl": sandbox.login_url(run_id), "quizTitle": quiz_title, "headless": headless,
               "model": None if dry_run else stagehand_model(model)}
    t0 = time.monotonic()
    try:
        p = subprocess.run(["node", str(STAGEHAND_SCRIPT), *(["--dry-run"] if dry_run else [])],
                           input=json.dumps(payload), capture_output=True, text=True, timeout=timeout,
                           cwd=STAGEHAND_SCRIPT.parent.parent)
        lines = [ln for ln in p.stdout.splitlines() if ln.startswith("{")]
        if not lines:
            raise RuntimeError(f"no result from stagehand (exit {p.returncode}): {p.stderr[-400:]}")
        r = json.loads(lines[-1])
    except Exception as e:
        return RunOutcome(run_id, "stagehand", model, "error", 0, time.monotonic() - t0, error=repr(e)[:500])
    return RunOutcome(run_id, "stagehand", model, r["status"], r["steps"], r["seconds"], error=r.get("error"),
                      trace=r.get("trace", []))


RUNNERS: dict[str, Callable[..., RunOutcome]] = {"browser-use": run_browser_use, "stagehand": run_stagehand}


def save_trace(outcome: RunOutcome, traces_dir: Path) -> Path:
    traces_dir.mkdir(parents=True, exist_ok=True)
    p = traces_dir / f"{outcome.run_id}.json"
    p.write_text(json.dumps(outcome.__dict__, indent=2, default=str))
    return p
