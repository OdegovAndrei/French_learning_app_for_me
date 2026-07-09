#!/usr/bin/env python3
import asyncio
import hashlib
import json
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

try:
    import edge_tts
except ImportError:
    edge_tts = None

DEFAULT_PORT = 5173
CACHE_DIR = Path(".tts-cache")
VOICES = {"fr-FR-DeniseNeural", "fr-FR-HenriNeural"}


def normalize_text(text):
    first_line = text.split("\n", 1)[0]
    return " ".join(first_line.split())


def round_rate_percent(rate):
    percent = (float(rate) - 1) * 100
    return round(percent / 5) * 5


def cache_key(text, voice, rate):
    normalized = normalize_text(text)
    percent = round_rate_percent(rate)
    payload = f"{normalized}|{voice}|{percent}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


async def synthesize(text, voice, rate):
    if edge_tts is None:
        raise RuntimeError("edge-tts is not installed")
    percent = round_rate_percent(rate)
    rate_str = f"{'+' if percent >= 0 else ''}{percent}%"
    communicate = edge_tts.Communicate(normalize_text(text), voice, rate=rate_str)
    chunks = bytearray()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            chunks.extend(chunk["data"])
    return bytes(chunks)


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/tts":
            self.handle_tts(parse_qs(parsed.query))
            return
        super().do_GET()

    def handle_tts(self, query):
        text = unquote(query.get("text", [""])[0])
        voice = query.get("voice", ["fr-FR-DeniseNeural"])[0]
        rate_raw = query.get("rate", ["1"])[0]

        if not text.strip():
            self.send_json_error(400, "Missing text")
            return
        if voice not in VOICES:
            self.send_json_error(400, "Unknown voice")
            return
        try:
            rate = float(rate_raw)
        except ValueError:
            self.send_json_error(400, "Invalid rate")
            return

        key = cache_key(text, voice, rate)
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache_path = CACHE_DIR / f"{key}.mp3"

        if not cache_path.exists():
            try:
                audio = asyncio.run(synthesize(text, voice, rate))
            except Exception as error:
                self.send_json_error(502, f"Synthesis failed: {error}")
                return
            cache_path.write_bytes(audio)

        body = cache_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "audio/mpeg")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.end_headers()
        self.wfile.write(body)

    def send_json_error(self, code, message):
        body = json.dumps({"error": message}).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format_string, *args):
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    httpd = ThreadingHTTPServer(("", port), Handler)
    print(f"Serving on http://localhost:{port}")
    if edge_tts is None:
        print("edge-tts is not installed — /tts will return 502 and the browser will fall back to its built-in voice.")
        print("Install with: pip install edge-tts")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
