#!/usr/bin/env python3
"""Static preview server for the Frontier experiments (Arena live preview).

Disables ALL HTTP caching so a plain reload always fetches the newest code,
pins the JavaScript MIME type so module scripts execute everywhere, and serves
with threads so the ~20 generator modules load in parallel.
"""
import functools
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = '/home/user/Frontier'


class NoCacheHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.html': 'text/html',
        '.css': 'text/css',
        '.json': 'application/json',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, *args):
        pass


port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
server = ThreadingHTTPServer(('0.0.0.0', port), functools.partial(NoCacheHandler, directory=ROOT))
print(f'serving {ROOT} on port {port} (no-cache, threaded)', flush=True)
server.serve_forever()
