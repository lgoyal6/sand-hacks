"""Allowlisting HTTPS CONNECT proxy for isolated attacks. Runs OUTSIDE the sandbox; inside, attack.sb only allows
outbound connections to localhost, so the only way out is through here, and here only the model APIs are reachable.
The browser, page fetch() calls and the agent's own Python networking therefore can't reach the open web.

  python isolation/egress_proxy.py <port-file>     # binds 127.0.0.1:<free port>, writes the port to <port-file>
"""

import asyncio
import os
import sys

ALLOW = {
    "api.gmi-serving.com",
    "generativelanguage.googleapis.com",
}
EXTRA = {h.strip() for h in os.environ.get("EGRESS_ALLOW", "").split(",") if h.strip()}


async def pipe(r: asyncio.StreamReader, w: asyncio.StreamWriter) -> None:
    try:
        while data := await r.read(65536):
            w.write(data)
            await w.drain()
    except (ConnectionError, asyncio.CancelledError):
        pass
    finally:
        w.close()


async def handle(cr: asyncio.StreamReader, cw: asyncio.StreamWriter) -> None:
    try:
        line = (await cr.readline()).decode("latin-1").strip()
        while (await cr.readline()) not in (b"\r\n", b"\n", b""):
            pass  # skip request headers
        method, target, *_ = line.split(" ") + ["", ""]
        host, _, port = target.rpartition(":")
        if method != "CONNECT" or port != "443" or host not in ALLOW | EXTRA:
            print(f"[egress] DENY {line}", file=sys.stderr, flush=True)
            cw.write(b"HTTP/1.1 403 Forbidden\r\n\r\n")
            await cw.drain()
            cw.close()
            return
        ur, uw = await asyncio.open_connection(host, 443)
        cw.write(b"HTTP/1.1 200 Connection established\r\n\r\n")
        await cw.drain()
        await asyncio.gather(pipe(cr, uw), pipe(ur, cw))
    except Exception as e:  # noqa: BLE001
        print(f"[egress] error {e!r}", file=sys.stderr, flush=True)
        cw.close()


async def main(port_file: str) -> None:
    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    with open(port_file, "w") as f:
        f.write(str(port))
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
