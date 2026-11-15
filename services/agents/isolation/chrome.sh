#!/bin/sh
# Chrome for isolated runs. Chrome's own sandbox can't initialize inside sandbox-exec ("sandbox initialization failed"),
# so it runs with --no-sandbox INSIDE the outer attack.sb profile, which still denies secrets, answer keys and other
# worktrees to Chrome too (so file:// can't read them either).
exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --no-sandbox "$@"
