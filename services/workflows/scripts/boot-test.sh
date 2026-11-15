#!/bin/zsh
# Key-free boot smoke test: bundle the Mastra entry exactly like `mastra dev`/`mastra build`, start the built
# server on a free port with NO API keys, and assert every registered agent and workflow loads.
# Builds in a throwaway copy, so it never touches the live dev server's .mastra/ output.
#   pnpm --filter @unprompted/workflows test:boot
set -euo pipefail
PKG=${0:A:h:h}
ROOT=${UNPROMPTED_ROOT:-${PKG:h:h}}
TMP=$(mktemp -d -t unprompted-boot)
trap 'kill $SERVER 2>/dev/null || true; rm -rf "$TMP"' EXIT
SERVER=""
cp -R "$PKG/src" "$PKG/package.json" "$PKG/tsconfig.json" "$TMP/"
ln -s "$PKG/node_modules" "$TMP/node_modules"
echo "[boot] building in $TMP"
(cd "$TMP" && env -i PATH="$PATH" HOME="$HOME" UNPROMPTED_ROOT="$ROOT" npx mastra build --force > build.log 2>&1) || { tail -30 "$TMP/build.log"; echo "[boot] FAIL: build"; exit 1; }
PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("",0));print(s.getsockname()[1]);s.close()')
echo "[boot] starting the built server on :$PORT with no API keys"
(cd "$TMP/.mastra/output" && env -i PATH="$PATH" HOME="$HOME" UNPROMPTED_ROOT="$ROOT" PORT=$PORT node index.mjs > "$TMP/server.log" 2>&1) &
SERVER=$!
for i in {1..60}; do curl -s -o /dev/null -m 2 "localhost:$PORT/api/agents" && break; kill -0 $SERVER 2>/dev/null || break; sleep 1; done
if ! curl -s -o /dev/null -m 2 "localhost:$PORT/api/agents"; then tail -30 "$TMP/server.log"; echo "[boot] FAIL: server did not start"; exit 1; fi
AGENTS=$(curl -s "localhost:$PORT/api/agents" | python3 -c 'import json,sys;print(" ".join(sorted(json.load(sys.stdin))))')
WORKFLOWS=$(curl -s "localhost:$PORT/api/workflows" | python3 -c 'import json,sys;print(" ".join(sorted(json.load(sys.stdin))))')
# Every agent id registered in src/mastra/index.ts must be served.
EXPECTED=$(python3 - "$PKG/src/mastra/index.ts" "$PKG/src/agents" <<'PY'
import re,sys,pathlib
idx=pathlib.Path(sys.argv[1]).read_text()
names=re.search(r"agents:\s*\{([^}]*)\}", idx).group(1).replace(" ","").split(",")
ids=[]
for f in pathlib.Path(sys.argv[2]).glob("*.ts"):
    t=f.read_text()
    for var,i in re.findall(r"export const (\w+) = new Agent\(\{\s*id:\s*\"([^\"]+)\"", t): 
        if var in names: ids.append(i)
print(" ".join(sorted(ids)))
PY
)
echo "[boot] agents: $AGENTS"
echo "[boot] workflows: $WORKFLOWS"
[[ "$AGENTS" == "$EXPECTED" ]] || { echo "[boot] FAIL: expected agents [$EXPECTED]"; exit 1; }
[[ " $WORKFLOWS " == *" transform "* ]] || { echo "[boot] FAIL: transform workflow missing"; exit 1; }
if grep -q "ERR_MODULE_NOT_FOUND\|Cannot find module" "$TMP/server.log"; then grep -m3 "Cannot find module" "$TMP/server.log"; echo "[boot] FAIL: module resolution"; exit 1; fi
echo "[boot] OK"
