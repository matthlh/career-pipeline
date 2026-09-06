#!/usr/bin/env python3
"""Static server for the viewer.

Not `python3 -m http.server`. That module evaluates `os.getcwd()` as an argparse
default at import time, which raises PermissionError when the launcher starts us
in a directory we cannot stat. Anchoring to this file's location avoids the
inherited cwd entirely.
"""
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

os.chdir(ROOT)
handler = partial(SimpleHTTPRequestHandler, directory=ROOT)
server = ThreadingHTTPServer(("127.0.0.1", PORT), handler)
print("serving %s at http://localhost:%d" % (ROOT, PORT), flush=True)
server.serve_forever()
