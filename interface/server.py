from http.server import SimpleHTTPRequestHandler, HTTPServer
import json
import os
import time

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
                # If responses.json is not found, create it with an empty messages array
                with open(RESPONSES_FILE, 'w') as f:
                    json.dump({"messages": []}, f)
                # Then, re-read and serve it
                with open(RESPONSES_FILE, 'r') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(content.encode())
            except Exception as e:
                self.send_error(500, f'Error reading responses.json: {e}')
        else:
            # Serve files from the current directory
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
                    json.dump({'command': cmd, 'timestamp': time.time()}, f)
                    f.write('\n')

                if cmd == '/reset':
                    # Clear responses.json on reset
                    with open(RESPONSES_FILE, 'w') as f:
                        json.dump({"messages": []}, f)
                    response_text = "Terminal reset."
                else:
                    response_text = f"Acknowledged command → {cmd}. Waiting for LLM response..."
                
                self._send_json({'response': response_text})

            except json.JSONDecodeError:
                self._send_json({'response': "Error: Invalid JSON payload."})
            except Exception as e:
                print(f"Error processing command: {e}")
                self._send_json({'response': f"Error processing command: {e}"})
        else:
            self.send_error(404, 'Endpoint not found')

if __name__ == '__main__':
    # Ensure commands.json and responses.json exist
    if not os.path.exists(COMMANDS_FILE):
        with open(COMMANDS_FILE, 'w') as f:
            f.write('')
    
    if not os.path.exists(RESPONSES_FILE):
        with open(RESPONSES_FILE, 'w') as f:
            json.dump({"messages": []}, f)

    # Change directory to where index.html is located
    web_dir = os.path.join(os.path.dirname(__file__))
    os.chdir(web_dir)

    server_address = ('', PORT)
    httpd = HTTPServer(server_address, TerminalHandler)
    print(f"Serving Holo-Suite Terminal at http://0.0.0.0:{PORT}/index.html")
    print("Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        httpd.server_close()