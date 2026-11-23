#!/usr/bin/env python3
"""Preview server for Experimental/UnifiedStudio on 0.0.0.0:8130 (give another port as the first argument)."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys

STUDIO_FOLDER = Path(__file__).resolve().parent


class StudioRequests(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    Port = int(sys.argv[1]) if len(sys.argv) > 1 else 8130
    Server = ThreadingHTTPServer(("0.0.0.0", Port), partial(StudioRequests, directory=str(STUDIO_FOLDER)))
    print(f"Unified Studio on http://0.0.0.0:{Port}/", flush=True)
    Server.serve_forever()
