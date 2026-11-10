#!/usr/bin/env python3
"""Servidor estático que sirve el export de Next bajo la SUBRUTA /NOSUELTES.

Imita el despliegue real en GitHub Pages (…github.io/NOSUELTES/) para poder
probar la exportación local con basePath antes de empujar. Uso:
    python3 scripts/sirve-out-subruta.py [puerto]
"""
import http.server
import os
import sys

BASE = "/NOSUELTES"
ROOT = "/home/z/my-project/out"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8777


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def translate_path(self, path):
        if path.startswith(BASE):
            path = path[len(BASE):] or "/"
        return super().translate_path(path)

    def log_message(self, fmt, *args):  # silencio: el sonda ya reporta
        pass


if __name__ == "__main__":
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler) as httpd:
        print(f"sirviendo {ROOT} en http://127.0.0.1:{PORT}{BASE}/", flush=True)
        httpd.serve_forever()
