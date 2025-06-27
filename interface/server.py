from http.server import SimpleHTTPRequestHandler, HTTPServer
import json
import subprocess
import sys
import os
from urllib.parse import urlparse, parse_qs

PORT = 8000
COMMANDS_FILE = 'commands.json'
RESPONSES_FILE = 'responses.json'

class TerminalHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/responses.json':
            try:
                with open(RESPONSES_FILE, 'r') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(content.encode())
            except FileNotFoundError:
                self.send_error(404, 'responses.json not found')
            except Exception as e:
                self.send_error(500, f'Error reading responses.json: {e}')
        else:
            super().do_GET()

    def _send_json(self, data):
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path == '/command':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                payload = json.loads(body or b"{}")
                cmd = payload.get('command', '')

                # Write command to commands.json
                with open(COMMANDS_FILE, 'a') as f:
                    json.dump({'command': cmd, 'timestamp': os.time()}, f)
                    f.write('\n') # Add newline for easier parsing of multiple commands

            except json.JSONDecodeError:
                cmd = ''
            except Exception as e:
                print(f"Error writing to commands.json: {e}")
                self._send_json({'response': f"Error processing command: {e}"})
                return

            # For demo, we just echo back. In a real scenario, an external process
            # would read commands.json, process it, and write to responses.json
            response_text = f"Acknowledged command → {cmd}. Waiting for LLM response..."
            self._send_json({'response': response_text})
        else:
            self.send_error(404, 'Endpoint not found')

if __name__ == '__main__':
    # Ensure commands.json and responses.json exist
    if not os.path.exists(COMMANDS_FILE):
        with open(COMMANDS_FILE, 'w') as f:
            f.write('') # Create empty file

    if not os.path.exists(RESPONSES_FILE):
        with open(RESPONSES_FILE, 'w') as f:
            json.dump({"messages": []}, f) # Create with empty messages array

    server_address = ('', PORT)  # Listen on all interfaces
    httpd = HTTPServer(server_address, TerminalHandler)
    print(f"Serving Holo-Suite Terminal at http://0.0.0.0:{PORT}/index.html")
    print("Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        httpd.server_close()