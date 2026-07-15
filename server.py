#!/usr/bin/env python3
import asyncio
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

try:
    import fcntl
except ImportError:
    fcntl = None

try:
    import edge_tts
except ImportError:
    edge_tts = None

DEFAULT_PORT = 5173
CACHE_DIR = Path(".tts-cache")
PROJECT_DIR = Path(__file__).resolve().parent
STORAGE_FILE = PROJECT_DIR / "user-data" / "french-study-data.json"
STORAGE_STORE_NAMES = ("kv", "vocabulary", "schedules", "reviewLogs", "exercises", "recordings")
MAX_STORAGE_BODY_BYTES = 384 * 1024 * 1024
STORAGE_THREAD_LOCK = threading.Lock()
VOICES = {"fr-FR-DeniseNeural", "fr-FR-HenriNeural"}
STT_MODEL = os.environ.get("FRENCH_STUDY_STT_MODEL", "base")
MAX_STT_AUDIO_BYTES = 25 * 1024 * 1024
STT_MEDIA_SUFFIXES = {
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/mp4": ".m4a",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav"
}


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


def transcribe_audio(audio, content_type):
    whisper = shutil.which("whisper")
    if whisper is None:
        raise RuntimeError("Локальный Whisper не установлен. Установи openai-whisper и перезапусти server.py.")

    media_type = content_type.split(";", 1)[0].strip().lower()
    suffix = STT_MEDIA_SUFFIXES.get(media_type, ".webm")
    with tempfile.TemporaryDirectory(prefix="french-study-stt-") as directory:
        workdir = Path(directory)
        audio_path = workdir / f"recording{suffix}"
        audio_path.write_bytes(audio)
        command = [
            whisper,
            str(audio_path),
            "--model", STT_MODEL,
            "--language", "fr",
            "--task", "transcribe",
            "--fp16", "False",
            "--output_format", "json",
            "--output_dir", str(workdir),
            "--verbose", "False"
        ]
        try:
            completed = subprocess.run(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                timeout=120,
                check=False
            )
        except subprocess.TimeoutExpired as error:
            raise RuntimeError("Распознавание заняло слишком много времени.") from error
        if completed.returncode != 0:
            detail = " ".join(completed.stdout.strip().splitlines()[-3:]).strip()
            raise RuntimeError(f"Whisper не смог обработать запись.{f' {detail}' if detail else ''}")

        result_path = audio_path.with_suffix(".json")
        if not result_path.exists():
            raise RuntimeError("Whisper не вернул результат распознавания.")
        try:
            transcript = json.loads(result_path.read_text(encoding="utf-8")).get("text", "").strip()
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError("Не удалось прочитать результат Whisper.") from error
        if not transcript:
            raise RuntimeError("В записи не удалось распознать французскую речь.")
        return transcript


class StorageRequestError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def storage_timestamp():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def empty_storage_snapshot():
    return {
        "format": "french-study-backup",
        "version": 1,
        "exportedAt": storage_timestamp(),
        "includesRecordings": True,
        "stores": {name: [] for name in STORAGE_STORE_NAMES}
    }


def validate_storage_snapshot(snapshot):
    if not isinstance(snapshot, dict) or snapshot.get("format") != "french-study-backup" or snapshot.get("version") != 1:
        raise StorageRequestError(400, "Invalid French Study storage snapshot")
    stores = snapshot.get("stores")
    if not isinstance(stores, dict) or set(stores) != set(STORAGE_STORE_NAMES):
        raise StorageRequestError(400, "Storage snapshot has an invalid stores section")
    for store_name in STORAGE_STORE_NAMES:
        records = stores[store_name]
        if not isinstance(records, list):
            raise StorageRequestError(400, f"Storage section {store_name} must be a list")
        key_name = "key" if store_name == "kv" else "id"
        seen = set()
        for record in records:
            if not isinstance(record, dict) or not isinstance(record.get(key_name), str) or not record[key_name].strip():
                raise StorageRequestError(400, f"Storage section {store_name} contains an invalid record")
            if record[key_name] in seen:
                raise StorageRequestError(400, f"Storage section {store_name} contains a duplicate key")
            seen.add(record[key_name])
    return snapshot


@contextmanager
def storage_file_lock():
    STORAGE_FILE.parent.mkdir(parents=True, exist_ok=True)
    lock_path = STORAGE_FILE.with_suffix(".lock")
    with STORAGE_THREAD_LOCK:
        with lock_path.open("a+", encoding="utf-8") as lock_handle:
            if fcntl is not None:
                fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                if fcntl is not None:
                    fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)


def read_storage_snapshot():
    if not STORAGE_FILE.exists():
        return None
    try:
        snapshot = json.loads(STORAGE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise StorageRequestError(500, "Файл прогресса повреждён; восстанови его из backup-файла в user-data.") from error
    return validate_storage_snapshot(snapshot)


def write_storage_snapshot(snapshot):
    validate_storage_snapshot(snapshot)
    STORAGE_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=STORAGE_FILE.parent,
            prefix=".french-study-data-",
            suffix=".tmp",
            delete=False
        ) as handle:
            json.dump(snapshot, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
            temporary_path = Path(handle.name)
        if STORAGE_FILE.exists():
            backup_path = STORAGE_FILE.with_name("french-study-data.backup.json")
            shutil.copy2(STORAGE_FILE, backup_path)
        os.replace(temporary_path, STORAGE_FILE)
        temporary_path = None
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def apply_storage_transaction(snapshot, transaction):
    if not isinstance(transaction, dict):
        raise StorageRequestError(400, "Storage transaction must be an object")
    puts = transaction.get("puts", [])
    deletes = transaction.get("deletes", [])
    clear_stores = transaction.get("clearStores", [])
    if not isinstance(puts, list) or not isinstance(deletes, list) or not isinstance(clear_stores, list):
        raise StorageRequestError(400, "Storage transaction sections must be lists")

    for store_name in clear_stores:
        if store_name not in STORAGE_STORE_NAMES:
            raise StorageRequestError(400, "Storage transaction references an unknown store")
        snapshot["stores"][store_name] = []

    for item in deletes:
        if not isinstance(item, dict) or item.get("store") not in STORAGE_STORE_NAMES or not isinstance(item.get("id"), str):
            raise StorageRequestError(400, "Storage transaction contains an invalid delete")
        store_name = item["store"]
        key_name = "key" if store_name == "kv" else "id"
        snapshot["stores"][store_name] = [
            record for record in snapshot["stores"][store_name] if record.get(key_name) != item["id"]
        ]

    for item in puts:
        if not isinstance(item, dict) or item.get("store") not in STORAGE_STORE_NAMES or not isinstance(item.get("record"), dict):
            raise StorageRequestError(400, "Storage transaction contains an invalid put")
        store_name = item["store"]
        record = item["record"]
        key_name = "key" if store_name == "kv" else "id"
        key = record.get(key_name)
        if not isinstance(key, str) or not key.strip():
            raise StorageRequestError(400, "Storage transaction record has no key")
        records = snapshot["stores"][store_name]
        for index, existing in enumerate(records):
            if existing.get(key_name) == key:
                records[index] = record
                break
        else:
            records.append(record)

    snapshot["exportedAt"] = storage_timestamp()
    snapshot["includesRecordings"] = True
    return validate_storage_snapshot(snapshot)


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        parsed = urlparse(self.path)
        suffix = Path(parsed.path).suffix.lower()
        if parsed.path == "/" or suffix in {".html", ".js", ".css", ".json"}:
            self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/storage":
            self.handle_storage_get()
            return
        if parsed.path == "/tts":
            self.handle_tts(parse_qs(parsed.query))
            return
        if "user-data" in Path(unquote(parsed.path)).parts:
            self.send_json_error(404, "Not found")
            return
        super().do_GET()

    def do_PUT(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/storage":
            self.handle_storage_put()
            return
        self.send_json_error(404, "Unknown endpoint")

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/storage/transaction":
            self.handle_storage_transaction()
            return
        if parsed.path == "/stt":
            self.handle_stt()
            return
        self.send_json_error(404, "Unknown endpoint")

    def handle_storage_get(self):
        try:
            with storage_file_lock():
                snapshot = read_storage_snapshot()
            self.send_json(200, {
                "exists": snapshot is not None,
                "storagePath": str(STORAGE_FILE.resolve()),
                "snapshot": snapshot
            })
        except StorageRequestError as error:
            self.send_json_error(error.status, str(error))

    def handle_storage_put(self):
        try:
            payload = self.read_json_body(MAX_STORAGE_BODY_BYTES)
            snapshot = validate_storage_snapshot(payload.get("snapshot") if isinstance(payload, dict) else None)
            initialize_only = payload.get("initializeOnly") is True
            with storage_file_lock():
                current = read_storage_snapshot()
                created = current is None
                if current is not None and initialize_only:
                    snapshot = current
                else:
                    write_storage_snapshot(snapshot)
            self.send_json(200, {
                "created": created,
                "storagePath": str(STORAGE_FILE.resolve()),
                "snapshot": snapshot
            })
        except StorageRequestError as error:
            self.send_json_error(error.status, str(error))
        except OSError as error:
            self.send_json_error(500, f"Не удалось сохранить файл прогресса: {error}")

    def handle_storage_transaction(self):
        try:
            transaction = self.read_json_body(MAX_STORAGE_BODY_BYTES)
            with storage_file_lock():
                snapshot = read_storage_snapshot() or empty_storage_snapshot()
                snapshot = apply_storage_transaction(snapshot, transaction)
                write_storage_snapshot(snapshot)
            self.send_json(200, {
                "saved": True,
                "storagePath": str(STORAGE_FILE.resolve()),
                "updatedAt": snapshot["exportedAt"]
            })
        except StorageRequestError as error:
            self.send_json_error(error.status, str(error))
        except OSError as error:
            self.send_json_error(500, f"Не удалось сохранить файл прогресса: {error}")

    def read_json_body(self, maximum_bytes):
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise StorageRequestError(400, "Invalid Content-Length") from error
        if content_length <= 0:
            raise StorageRequestError(400, "Missing JSON body")
        if content_length > maximum_bytes:
            raise StorageRequestError(413, "Storage request is too large")
        body = self.rfile.read(content_length)
        if len(body) != content_length:
            raise StorageRequestError(400, "Incomplete JSON body")
        try:
            return json.loads(body)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise StorageRequestError(400, "Invalid JSON body") from error

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

    def handle_stt(self):
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json_error(400, "Invalid Content-Length")
            return
        if content_length <= 0:
            self.send_json_error(400, "Missing audio recording")
            return
        if content_length > MAX_STT_AUDIO_BYTES:
            self.send_json_error(413, "Audio recording is too large")
            return

        content_type = self.headers.get("Content-Type", "audio/webm")
        if not content_type.lower().startswith("audio/"):
            self.send_json_error(415, "Expected an audio recording")
            return
        audio = self.rfile.read(content_length)
        if len(audio) != content_length:
            self.send_json_error(400, "Incomplete audio recording")
            return

        try:
            transcript = transcribe_audio(audio, content_type)
        except RuntimeError as error:
            self.send_json_error(503, str(error))
            return
        body = json.dumps({"transcript": transcript}, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_json_error(self, code, message):
        self.send_json(code, {"error": message})

    def send_json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format_string, *args):
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Serving on http://localhost:{port}")
    if edge_tts is None:
        print("edge-tts is not installed — /tts will return 502 and the browser will fall back to its built-in voice.")
        print("Install with: pip install edge-tts")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
