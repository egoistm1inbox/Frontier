#!/usr/bin/env python3
"""Static preview server for the Fracture Editor.  Usage: python3 Serve.py [port]"""
import functools
import http.server
import pathlib
import sys


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript", ".svg": "image/svg+xml", ".ttf": "font/ttf"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8091
    root = pathlib.Path(__file__).resolve().parent
    server = http.server.ThreadingHTTPServer(("0.0.0.0", port), functools.partial(Handler, directory=str(root)))
    print(f"Fracture Editor on http://0.0.0.0:{port}/", flush=True)
    server.serve_forever()
