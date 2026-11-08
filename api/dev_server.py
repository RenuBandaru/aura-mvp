"""Run AURA on your laptop with nothing but Python.

    python api/dev_server.py            API on http://localhost:7071, data kept in api/.data/aura.json
    python api/dev_server.py --memory   start fresh every time, save nothing

If the React app has been built (``npm run build`` in ``web/``), this server also serves it, so the
whole app is at http://localhost:7071. While working on the screens, run ``npm run dev`` in ``web/``
instead; Vite serves the screens on http://localhost:5173 and forwards ``/api`` calls here.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE.parent / "engine"), str(HERE)]  # find aura_engine and aura_api without installing them

from aura_api.routes import dispatch  # noqa: E402
from aura_engine.jsx import js_json  # noqa: E402
from aura_api.store import Store  # noqa: E402

WEB_DIST = HERE.parent / "web" / "dist"


def make_handler(store: Store):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, status: int, body: bytes, ctype: str):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _api(self, method: str):
            url = urlsplit(self.path)
            body = None
            if method == "POST":
                raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                try:
                    body = json.loads(raw or b"{}")
                except json.JSONDecodeError:
                    return self._send(400, b'{"error":"The request body is not valid JSON."}', "application/json")
            status, out = dispatch(store, method, url.path, dict(parse_qsl(url.query)), body, dict(self.headers))
            self._send(status, js_json(out).encode("utf-8"), "application/json; charset=utf-8")

        def _static(self):
            """Serve the built React app; unknown paths get index.html so page links work on refresh."""
            rel = urlsplit(self.path).path.lstrip("/") or "index.html"
            f = (WEB_DIST / rel).resolve()
            if not str(f).startswith(str(WEB_DIST.resolve())) or not f.is_file():
                f = WEB_DIST / "index.html"
            if not f.is_file():
                return self._send(404, b"The React app is not built yet. Run: cd web && npm install && npm run build", "text/plain")
            self._send(200, f.read_bytes(), mimetypes.guess_type(f.name)[0] or "application/octet-stream")

        def do_GET(self):
            self._api("GET") if self.path.startswith("/api/") else self._static()

        def do_POST(self):
            self._api("POST") if self.path.startswith("/api/") else self._send(404, b"", "text/plain")

        def log_message(self, fmt, *args):  # one short line per request
            sys.stderr.write("%s %s\n" % (self.command, self.path.split("?")[0]))

    return Handler


def main():
    ap = argparse.ArgumentParser(description="Run the AURA API (and the built React app) locally.")
    ap.add_argument("--port", type=int, default=7071)
    ap.add_argument("--memory", action="store_true", help="do not save data between runs")
    args = ap.parse_args()
    store = Store(None if args.memory else HERE / ".data" / "aura.json")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(store))
    print(f"AURA is running on http://localhost:{args.port}  (Ctrl+C to stop)")
    if not (WEB_DIST / "index.html").is_file():
        print("The screens are not built yet. In another terminal: cd web && npm install && npm run dev, then open http://localhost:5173")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
