"""Record a REAL browser-use run taking the sandbox quiz, for the 20-second demo opener.

Chrome runs with remote debugging; browser-use drives it through cdp_url while demo/recorder.mjs screenshots the
same page. The result is graded by the sandbox like any attack run, and the video is only kept as "the agent aced
it" if the sandbox says so. Nothing is staged: no answers are given to the agent.

  uv run python demo/record_demo.py --model gmi:google/gemini-3.8-flash --speed 3
Writes data/demo/agent-run-<runId>.mp4 (real time), ...-fast.mp4 (sped up) and ...json (run facts).
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "src"))

from dotenv import load_dotenv  # noqa: E402

from unprompted_agents.attack import to_agent_runs  # noqa: E402
from unprompted_agents.runners import RunOutcome, make_llm  # noqa: E402
from unprompted_agents.sandbox import Sandbox  # noqa: E402

REPO = HERE.parents[2]
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_cdp(url: str, timeout: float = 20) -> None:
    import httpx

    end = time.time() + timeout
    while time.time() < end:
        try:
            httpx.get(f"{url}/json/version", timeout=1).raise_for_status()
            return
        except Exception:
            time.sleep(0.2)
    raise RuntimeError("Chrome did not open its debugging port")


def encode(frames: Path, out: Path, speed: float) -> None:
    files = sorted(frames.glob("*.jpg"))
    if len(files) < 2:
        raise RuntimeError("no frames captured")
    # Concat list with each frame's real duration (to the next frame), divided by speed.
    lst = frames / "list.txt"
    with lst.open("w") as f:
        for a, b in zip(files, files[1:]):
            f.write(f"file '{a.name}'\nduration {max(0.02, (int(b.stem) - int(a.stem)) / 1000 / speed):.3f}\n")
        f.write(f"file '{files[-1].name}'\nduration 1.5\nfile '{files[-1].name}'\n")  # hold the final frame
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst),
                    "-vf", "scale=1280:-2,format=yuv420p", "-r", "30", "-c:v", "libx264", "-crf", "23", str(out)],
                   check=True, cwd=frames)


def main() -> int:
    load_dotenv(REPO / ".env.local")
    os.environ.setdefault("ANONYMIZED_TELEMETRY", "false")
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="gmi:google/gemini-3.8-flash")
    ap.add_argument("--quiz", default=str(REPO / "apps/sandbox/quizzes/sample-stats.json"))
    ap.add_argument("--speed", type=float, default=3.0, help="speed-up for the -fast video")
    ap.add_argument("--out-dir", default=str(REPO / "data/demo"))
    a = ap.parse_args()

    from browser_use import Agent, Browser

    sandbox = Sandbox()
    quiz = json.loads(Path(a.quiz).read_text())
    sandbox.register(quiz)
    run_id = f"demo-{int(time.time())}"
    port = free_port()
    cdp = f"http://127.0.0.1:{port}"
    profile = tempfile.mkdtemp(prefix="unprompted-demo-")
    frames = Path(tempfile.mkdtemp(prefix="unprompted-frames-"))
    chrome = subprocess.Popen([CHROME, f"--remote-debugging-port={port}", f"--user-data-dir={profile}", "--headless=new",
                               "--window-size=1280,800", "--no-first-run", "--no-default-browser-check", "about:blank"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    recorder = None
    try:
        wait_cdp(cdp)
        recorder = subprocess.Popen(["node", str(HERE / "recorder.mjs"), cdp, str(frames)], cwd=HERE.parent,
                                    stdout=subprocess.PIPE, text=True)
        time.sleep(1.0)
        browser = Browser(cdp_url=cdp, allowed_domains=[sandbox.netloc])
        agent = Agent(sandbox.task(run_id, quiz["title"]), llm=make_llm(a.model), browser=browser,
                      workspace=tempfile.mkdtemp(prefix="unprompted-bu-"))
        t0 = time.monotonic()
        result = agent.run_sync(max_steps=40, timeout=600)
        time.sleep(2.0)  # keep recording the "Quiz submitted" page
        outcome = RunOutcome(run_id, "browser-use", a.model, result.status, result.steps, result.duration_s or time.monotonic() - t0,
                             error=result.error)
    finally:
        if recorder:
            recorder.send_signal(signal.SIGTERM)
            rec_info = recorder.communicate(timeout=30)[0].strip().splitlines()[-1:] or ["{}"]
        chrome.terminate()
        shutil.rmtree(profile, ignore_errors=True)

    runs, meta = to_agent_runs(quiz, outcome, sandbox.run_results(run_id), [i["id"] for i in quiz["items"]])
    facts = {**meta, "quizId": quiz["id"], "recorder": json.loads(rec_info[0]) if rec_info else None,
             "note": "Real browser-use run, graded server-side by the sandbox. No answers were given to the agent."}
    print(json.dumps({k: facts[k] for k in ("runId", "model", "status", "submitted", "score", "steps", "seconds")}))
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    base = out / f"agent-run-{run_id}"
    encode(frames, base.with_suffix(".mp4"), 1.0)
    encode(frames, base.parent / f"{base.name}-fast.mp4", a.speed)
    base.with_suffix(".json").write_text(json.dumps(facts, indent=2) + "\n")
    shutil.rmtree(frames, ignore_errors=True)
    print(f"wrote {base}.mp4, {base.name}-fast.mp4, {base.name}.json")
    return 0 if facts["score"] == 1.0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
