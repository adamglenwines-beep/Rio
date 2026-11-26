#!/usr/bin/env python3
"""
Tiny local web server for Borgo.

    python3 serve.py          (macOS / Linux)
    py serve.py               (Windows)

Then open the printed address on this computer, or the "phone" address on a
phone connected to the same Wi-Fi. Press Ctrl+C to stop.
"""
import http.server
import os
import socket
import socketserver

PORT = int(os.environ.get("PORT", 8000))
os.chdir(os.path.dirname(os.path.abspath(__file__)))


def lan_ip():
    """Best guess at this computer's address on the local network."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # No data is sent: connecting a UDP socket just picks the outgoing interface.
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript"}

    def end_headers(self):
        # always serve fresh files while you're tinkering
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass  # keep the terminal quiet


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True


with Server(("0.0.0.0", PORT), Handler) as httpd:
    print("\n  Borgo is running!\n")
    print(f"  On this computer:  http://localhost:{PORT}")
    print(f"  On your phone:     http://{lan_ip()}:{PORT}   (same Wi-Fi)\n")
    print("  Press Ctrl+C to stop.\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped.")
