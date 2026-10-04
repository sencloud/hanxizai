#!/usr/bin/env python3
"""本地预览：项目本身不需要服务器（没有模块，素材元数据是普通脚本，贴图用 <img> 加载），
用这个脚本只是为了在 file:// 受限的浏览设置下也能打开。"""
import argparse
import http.server
import os
import socketserver

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    # 浏览器会同时拉十几个脚本和贴图；队列太短时，多出来的连接会被直接拒绝
    request_queue_size = 64


def main():
    parser = argparse.ArgumentParser(description="预览《韩熙载夜宴图》互动长卷")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    with Server(("127.0.0.1", args.port), Handler) as httpd:
        print(f"http://127.0.0.1:{args.port}/index.html", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
