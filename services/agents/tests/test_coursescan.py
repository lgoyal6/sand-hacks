"""Course-site scan: safety rules and output shape, against a tiny local site. No network, no LLM."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from unprompted_agents.coursescan import blocked_host, crawl, scan

PAGES = {
    "/robots.txt": ("text/plain", "User-agent: *\nDisallow: /private/\n"),
    "/": ("text/html", '<h1>Stats 101</h1><a href="/hw1.html">HW 1</a><a href="/login.html">Log in</a>'
                       '<a href="/private/key.html">key</a><a href="/challenge.html">x</a>'
                       '<a href="https://www.chegg.com/x">elsewhere</a><a href="/hw1.html#q2">same</a>'),
    "/hw1.html": ("text/html", "<h2>Homework 1</h2><p>1. A sample of 25 has mean 40 and standard deviation 10. "
                               "What is the standard error of the mean?</p><script>secret()</script>"),
    "/login.html": ("text/html", '<form action="/login"><input type="password" name="pw"></form>'),
    "/challenge.html": ("text/html", '<div class="cf-challenge">Verify you are human</div>'),
    "/private/key.html": ("text/html", "answer key"),
}


class H(BaseHTTPRequestHandler):
    def do_GET(self):
        ctype, body = PAGES.get(self.path, ("text/plain", "nope"))
        self.send_response(200 if self.path in PAGES else 404)
        self.send_header("content-type", ctype)
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, *a):
        pass


@pytest.fixture(scope="module")
def site():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}/"
    srv.shutdown()


def test_crawl_respects_rules(site):
    res = crawl(site, delay=0, log=lambda m: None)
    urls = [p.url for p in res.pages]
    assert urls == [site, site + "hw1.html"]  # fragment de-duplicated, off-host link never followed
    reasons = {s["url"].rsplit("/", 1)[-1]: s["reason"] for s in res.skipped}
    assert "robots" in reasons["key.html"] and "login" in reasons["login.html"] and "challenge" in reasons["challenge.html"]
    assert "secret()" not in res.pages[1].text  # scripts are not page text


def test_blocked_hosts_and_consent(site):
    for h in ("canvas.ucsd.edu", "ucsd.instructure.com", "piazza.com", "www.gradescope.com", "quizlet.com"):
        assert blocked_host(h)
    with pytest.raises(ValueError):
        crawl("https://ucsd.instructure.com/courses/1", delay=0)
    with pytest.raises(PermissionError):
        scan(site, owner_confirmed=False)


def test_scan_card_and_record_without_page_text(site):
    def extract(page):
        return ["A sample of 25 has mean 40 and standard deviation 10. What is the standard error of the mean?"] \
            if page.url.endswith("hw1.html") else []

    def leakcheck(qs):
        return {qs[0]["id"]: [{"url": "https://www.chegg.com/q/123", "sourceType": "chegg", "matchScore": 0.92,
                                "snippet": "Solved: A sample of 25..."}]}

    out = scan(site, owner_confirmed=True, extract=extract, leakcheck=leakcheck, delay=0, log=lambda m: None)
    card, record = out["card"], out["record"]
    assert card["headline"] == "1 of your 1 posted problems are already on homework sites"
    assert card["consent"] == "Only scan sites you own or teach."
    assert card["rows"][0]["stem"].startswith("A sample of 25")
    stored = json.dumps(record)
    assert "A sample of 25" not in stored and "snippet" not in stored  # hashes and URLs only
    assert record["rows"][0]["hash"] and record["rows"][0]["sourceUrl"].endswith("hw1.html")
