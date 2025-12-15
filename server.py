import http.server
import socketserver
import subprocess
import json
import os

PORT = 8000

class MyHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/api/update':
            print("Received update request...")
            try:
                # Run the update script
                result = subprocess.run(
                    ["python", "update_data.py"], 
                    capture_output=True, 
                    text=True, 
                    check=True
                )
                print("Update successful!")
                print("Output:", result.stdout)
                
                # Send success response
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {"status": "success", "message": "Data updated successfully", "log": result.stdout}
                self.wfile.write(json.dumps(response).encode('utf-8'))
                
            except subprocess.CalledProcessError as e:
                print("Update failed:", e)
                print("Stderr:", e.stderr)
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {"status": "error", "message": "Update failed", "log": e.stderr}
                self.wfile.write(json.dumps(response).encode('utf-8'))
        else:
            self.send_error(404, "Not Found")

print(f"Server started at http://localhost:{PORT}")
print("Press Ctrl+C to stop.")

# Use ThreadingTCPServer to handle multiple requests (e.g. running update + polling status)
with socketserver.ThreadingTCPServer(("", PORT), MyHandler) as httpd:
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
