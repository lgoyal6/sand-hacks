#!/bin/zsh
# Isolated attack: the agent's host-side Python can't read answer keys, API key files, other worktrees or
# credentials, and can't list processes (see attack.sb). Usage:
#   isolation/run.sh <quiz.json|quiz.md|-> [attack args...]   e.g. isolation/run.sh ../../data/quizzes/econ-micro.md --repeats 3
# With --json (or --events) the result goes to stdout and no fixtures are written (what B's workflow uses); logs go to
# stderr. "-" reads the quiz JSON from stdin.
set -euo pipefail
HERE=${0:A:h}; AGENTS=${HERE:h}; REPO=${AGENTS:h:h}; PROJECTS=${REPO:h}
QUIZ=$1; shift
[[ $QUIZ != - ]] && QUIZ=${QUIZ:A}
TARGET=sandbox; STREAM=0
for x in "$@"; do [[ $x == runtime ]] && TARGET=runtime; [[ $x == --json || $x == --events ]] && STREAM=1; done
WORK=$(mktemp -d -t unprompted-iso)
trap 'rm -rf $WORK' EXIT
cd $AGENTS
# 1. Outside the sandbox: only the model keys and runner token, and the quiz as JSON.
.venv/bin/python - $REPO/.env.local > $WORK/env <<'PY'
import sys
from dotenv import dotenv_values
v = dotenv_values(sys.argv[1])
for k in ("GEMINI_API_KEY", "GMI_API_KEY", "GMI_BASE_URL", "SANDBOX_RUNNER_TOKEN"):
    if v.get(k): print(f"{k}={v[k]}")
PY
[[ $QUIZ == - ]] && { cat > $WORK/stdin.json; QUIZ=$WORK/stdin.json; }
.venv/bin/python -c "
import json,sys; sys.path.insert(0,'src')
from unprompted_agents.quiz_md import parse_quiz_md
p=sys.argv[1]; q=parse_quiz_md(p) if p.endswith('.md') else json.load(open(p)); json.dump(q,open(sys.argv[2],'w'))" $QUIZ $WORK/quiz.json
QUIZ_ID=$(.venv/bin/python -c "import json,sys;print(json.load(open(sys.argv[1]))['id'])" $WORK/quiz.json)
# 2. Sandboxed attack. Stream mode passes stdout straight through (live --events); otherwise capture for the merge.
sandboxed() {
  env $(cat $WORK/env | xargs) ANONYMIZED_TELEMETRY=false BH_CHROME_PATH=$HERE/chrome.sh \
    sandbox-exec -f $HERE/attack.sb -D REPO=$REPO -D PROJECTS=$PROJECTS -D HOME=$HOME -D WORK=${WORK:A} \
    .venv/bin/attack --quiz - --json "$@" < $WORK/quiz.json
}
if (( STREAM )); then sandboxed "$@"; exit $?; fi
sandboxed "$@" > $WORK/result.json
# 3. Outside again: merge into the fixtures.
.venv/bin/attack-merge $WORK/result.json --quiz-id $QUIZ_ID --target $TARGET
