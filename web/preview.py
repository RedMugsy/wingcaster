import http.server
import socketserver
import os
import sys

PORT = 7100
SERVE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")

if not os.path.isdir(SERVE_DIR):
    print(f"Error: {SERVE_DIR} does not exist. Run the build first.")
    sys.exit(1)

os.chdir(SERVE_DIR)

class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Add CORS headers so the frontend can call localhost:3001
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        super().end_headers()

    def do_GET(self):
        # If the path is not a file, serve index.html for SPA routing
        path = self.translate_path(self.path)
        if not os.path.exists(path) or os.path.isdir(path):
            self.path = "/index.html"
        return super().do_GET()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

Handler = SPAHandler

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Serving SPA from {SERVE_DIR} at http://localhost:{PORT}")
    httpd.serve_forever()
