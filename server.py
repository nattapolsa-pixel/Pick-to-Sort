from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent


class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 5174), DashboardHandler)
    print("Pick to Sort dashboard server: http://127.0.0.1:5174/")
    server.serve_forever()


if __name__ == "__main__":
    main()
