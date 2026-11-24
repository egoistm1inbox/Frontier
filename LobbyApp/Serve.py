#!/usr/bin/env python3
"""Preview server for the Lobby App on 0.0.0.0 (default port 8096).

Serves this LobbyApp directory with no-store caching; / redirects to Lobby.html.
Usage: python3 LobbyApp/Serve.py [port]
"""
import functools
import http.server
import pathlib
import sys


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript"}

    def redirect_root(self):
        if self.path in ("/", "/index.html"):
            # Serve the landing page at /index.html, Lobby at /Lobby.html
            return False
        return False

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8096
    root = pathlib.Path(__file__).resolve().parent
    server = http.server.ThreadingHTTPServer(("0.0.0.0", port), functools.partial(Handler, directory=str(root)))
    print(f"Lobby App on http://0.0.0.0:{port}/  (Lobby: /Lobby.html)", flush=True)
    server.serve_forever()
