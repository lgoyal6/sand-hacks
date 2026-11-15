#!/bin/zsh
# Record the demo video of a REAL browser-use run, under the same isolation as attacks (attack.sb, egress proxy).
#   isolation/record.sh [quiz.json] [record_demo.py args...]     default quiz: apps/sandbox/quizzes/sample-stats.json
set -euo pipefail
HERE=${0:A:h}; AGENTS=${HERE:h}; REPO=${AGENTS:h:h}; PROJECTS=${REPO:h}
QUIZ=${1:-$REPO/apps/sandbox/quizzes/sample-stats.json}; [[ $# -gt 0 ]] && shift
WORK=$(mktemp -d -t unprompted-rec); OUT=$(mktemp -d -t unprompted-rec-out); PROXY_PID=""
trap '[[ -n $PROXY_PID ]] && kill $PROXY_PID 2>/dev/null; rm -rf $WORK $OUT' EXIT
cd $AGENTS
.venv/bin/python - $REPO/.env.local > $WORK/env <<'PY'
import sys
from dotenv import dotenv_values
v = dotenv_values(sys.argv[1])
import os
for k in ("GMI_REASONING_EFFORT", "RUNTIME_VOICE_REQUIRED"):
    if os.environ.get(k): print(f"{k}={os.environ[k]}")
for k in ("GEMINI_API_KEY", "GMI_API_KEY", "GMI_BASE_URL", "SANDBOX_RUNNER_TOKEN"):
    if v.get(k): print(f"{k}={v[k]}")
PY
cp ${QUIZ:A} $WORK/quiz.json
.venv/bin/python $HERE/egress_proxy.py $WORK/proxy.port 2>>$WORK/egress.log &
PROXY_PID=$!
for i in {1..50}; do [[ -s $WORK/proxy.port ]] && break; sleep 0.1; done
PROXY=http://127.0.0.1:$(cat $WORK/proxy.port)
env $(cat $WORK/env | xargs) ANONYMIZED_TELEMETRY=false BH_CHROME_PATH=$HERE/chrome.sh \
  HTTPS_PROXY=$PROXY https_proxy=$PROXY NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 \
  sandbox-exec -f $HERE/attack.sb -D REPO=$REPO -D PROJECTS=$PROJECTS -D HOME=$HOME -D WORK=${WORK:A} \
  .venv/bin/python demo/record_demo.py --quiz - --out-dir $OUT "$@" < $WORK/quiz.json
# Demo videos stay out of git: they go to the shared context folder.
DEST=${DEMO_VIDEO_DIR:-$PROJECTS/sand-hacks-context/demo-videos}
mkdir -p $DEST && cp $OUT/* $DEST/ && ls -1 $OUT && echo "saved to $DEST"
grep DENY $WORK/egress.log >&2 || true
