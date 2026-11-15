#!/bin/zsh
# Isolated attack: the agent's host-side Python can't read answer keys, API key files, other worktrees or
# credentials, and can't list processes (see attack.sb). Usage:
#   isolation/run.sh <quiz.json|quiz.md> [attack args...]      e.g. isolation/run.sh ../../data/quizzes/econ-micro.md --repeats 3
set -euo pipefail
HERE=${0:A:h}; AGENTS=${HERE:h}; REPO=${AGENTS:h:h}; PROJECTS=${REPO:h}
QUIZ=${1:A}; shift
TARGET=sandbox; for x in "$@"; do [[ $x == runtime ]] && TARGET=runtime; done
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
.venv/bin/python -c "
import json,sys; sys.path.insert(0,'src')
from unprompted_agents.quiz_md import parse_quiz_md
p=sys.argv[1]; q=parse_quiz_md(p) if p.endswith('.md') else json.load(open(p)); json.dump(q,open(sys.argv[2],'w'))" $QUIZ $WORK/quiz.json
QUIZ_ID=$(.venv/bin/python -c "import json,sys;print(json.load(open(sys.argv[1]))['id'])" $WORK/quiz.json)
# 2. Sandboxed attack, result as JSON.
env $(cat $WORK/env | xargs) ANONYMIZED_TELEMETRY=false \
  sandbox-exec -f $HERE/attack.sb -D REPO=$REPO -D PROJECTS=$PROJECTS -D HOME=$HOME \
  .venv/bin/attack --quiz - --json "$@" < $WORK/quiz.json > $WORK/result.json
# 3. Outside again: merge into the fixtures.
.venv/bin/attack-merge $WORK/result.json --quiz-id $QUIZ_ID --target $TARGET
