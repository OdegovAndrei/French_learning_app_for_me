# TTS Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the browser `speechSynthesis` TTS (robotic, inaccurate, device-dependent) with a local `edge-tts`-backed proxy plus pre-generated static audio for lesson content, so pronunciation is consistently high-quality for both lesson phrases and user-added vocabulary, while staying fully free and local.

**Architecture:** A small Python server (`server.py`, replacing `python3 -m http.server`) serves static files and a `/tts` endpoint that synthesizes speech via the free `edge-tts` library and caches results on disk by content hash. Lesson content from `data/lessons.json` is pre-synthesized once by `scripts/prewarm_tts.py` into committed static files (`data/audio/*.mp3` + `manifest.json`). The frontend (`tts.js`) plays manifest-listed lesson audio directly, caches any other synthesized audio (e.g. custom vocabulary) in IndexedDB after first fetch, and falls back to the existing `speechSynthesis` API if the server/network is unavailable.

**Tech Stack:** Python 3.9+ stdlib `http.server` (no new runtime deps beyond optional `edge-tts`), vanilla JS ES modules (existing project style), IndexedDB (existing `storage.js` wrapper), Web Crypto (`crypto.subtle`) for cache-key hashing shared between Python and JS.

## Global Constraints

- Stays free and local — no paid APIs, no accounts, no API keys (per README: "платные курсы и подписки не используются").
- `edge-tts` is an **optional** dependency: without it, static files still play and `/tts` degrades to a clean 502 that triggers the browser fallback — nothing breaks.
- Backups (`exportDatabase`/`importDatabase`/`validateBackup`) must **not** start including the new `ttsAudio` IndexedDB store — it's disposable cache, not user progress, and including it would silently bloat the "light copy without audio" backup that README promises.
- `DB_VERSION` in `storage.js` must be bumped so existing users get the new `ttsAudio` object store created via the upgrade path.
- Exactly two voices: `fr-FR-DeniseNeural` (default) and `fr-FR-HenriNeural`. No system-voice discovery.
- Speed slider stays as-is: range 0.55–1.10, step 0.05.
- The cache-key algorithm (normalize text → strip everything after first newline, collapse whitespace; round rate to nearest 5% of a 1.0-centered percentage; `sha256(normalizedText|voiceId|roundedPercent)`) must be implemented **identically** in `server.py` and `tts.js` — it's the join key between the disk cache, the manifest, the live endpoint, and the browser's IndexedDB cache.

---

## File Structure

- **Create** `server.py` — replaces `python3 -m http.server`; static file serving + `/tts` endpoint + disk cache.
- **Create** `scripts/prewarm_tts.py` — one-time/manual batch synthesis of all `data/lessons.json` speakable text into `data/audio/`.
- **Create** `tts.js` — frontend TTS module: cache-key helpers (shared algorithm), manifest lookup, IndexedDB cache, live fetch, `speechSynthesis` fallback.
- **Create** `tests/tts-cache.mjs` — Node tests for `tts.js`'s pure cache-key helpers.
- **Create** `tests/test_server.py` — Python tests for `server.py`'s `/tts` routing and disk cache (edge-tts mocked, no network).
- **Create** `tests/test_prewarm.py` — Python tests for `scripts/prewarm_tts.py`'s text collection and manifest writing (edge-tts mocked).
- **Modify** `storage.js` — add `ttsAudio` as a cache-only IndexedDB store, kept out of the backup contract.
- **Modify** `app.js` — wire `speakFrench` through `tts.js`, replace system-voice settings UI with the two fixed voices, update `defaultSettings()`.
- **Modify** `README.md` — run instructions, optional `edge-tts` install, new test commands, updated file list.
- **Modify** `.gitignore` — ignore the runtime disk cache directory `.tts-cache/` (the committed pre-generated files live in `data/audio/`, which is *not* ignored).
- **Create (generated, committed)** `data/audio/*.mp3`, `data/audio/manifest.json` — output of `scripts/prewarm_tts.py`, produced in Task 7.

---

### Task 1: Storage — add a cache-only `ttsAudio` IndexedDB store

**Files:**
- Modify: `storage.js:1-32` (constants + `openDatabase`), `storage.js:323-328` (`clearDatabase`)
- Test: `tests/technical.mjs`

**Interfaces:**
- Produces: `STORE_NAMES` (unchanged — backup-relevant stores only), `CACHE_STORE_NAMES = ["ttsAudio"]`, `ALL_STORE_NAMES = [...STORE_NAMES, ...CACHE_STORE_NAMES]`, `DB_VERSION` (now exported, value `2`). `openDatabase()` creates the `ttsAudio` store (keyPath `"id"`) on upgrade. `clearDatabase()` clears it too. `exportDatabase`/`importDatabase`/`validateBackup` are untouched and continue to operate on `STORE_NAMES` only.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test**

Add to `tests/technical.mjs`, right after the existing imports:

```js
import {
  ALL_STORE_NAMES,
  CACHE_STORE_NAMES,
  DB_VERSION,
  STORE_NAMES,
  normalizeCompletionModel,
  validateBackup
} from "../storage.js";

assert.deepEqual(CACHE_STORE_NAMES, ["ttsAudio"], "ttsAudio is the only cache-only store");
assert.ok(!STORE_NAMES.includes("ttsAudio"), "ttsAudio must never be part of the backup contract");
assert.deepEqual(ALL_STORE_NAMES, [...STORE_NAMES, ...CACHE_STORE_NAMES], "ALL_STORE_NAMES = backup stores + cache stores");
assert.equal(DB_VERSION, 2, "DB_VERSION must be bumped so existing users get the new store");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/technical.mjs`
Expected: FAIL with `SyntaxError` or `undefined` comparison failure — `CACHE_STORE_NAMES`/`ALL_STORE_NAMES`/`DB_VERSION` are not exported yet.

- [ ] **Step 3: Implement in storage.js**

Replace `storage.js:1-11`:

```js
const DB_NAME = "FrenchStudyDB";
export const DB_VERSION = 2;

export const STORE_NAMES = [
  "kv",
  "vocabulary",
  "schedules",
  "reviewLogs",
  "exercises",
  "recordings"
];

export const CACHE_STORE_NAMES = ["ttsAudio"];

export const ALL_STORE_NAMES = [...STORE_NAMES, ...CACHE_STORE_NAMES];
```

Replace `storage.js:15-32` (`openDatabase`), changing the upgrade loop to use `ALL_STORE_NAMES`:

```js
export function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.addEventListener("upgradeneeded", () => {
        const database = request.result;
        for (const name of ALL_STORE_NAMES) {
          if (!database.objectStoreNames.contains(name)) {
            database.createObjectStore(name, { keyPath: name === "kv" ? "key" : "id" });
          }
        }
      });
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });
  }
  return databasePromise;
}
```

Replace `storage.js:323-328` (`clearDatabase`), so a full reset also clears the disposable cache:

```js
export async function clearDatabase() {
  const database = await openDatabase();
  const transaction = database.transaction(ALL_STORE_NAMES, "readwrite");
  for (const name of ALL_STORE_NAMES) transaction.objectStore(name).clear();
  await transactionDone(transaction);
}
```

Leave `exportDatabase`, `validateBackup`, `importDatabase` exactly as they are — they must keep iterating `STORE_NAMES`, not `ALL_STORE_NAMES`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/technical.mjs`
Expected: PASS (prints nothing on success per this project's convention — exits 0). Also re-run the full suite to confirm no regression: `node tests/smoke.mjs && node tests/exercises.mjs && node tests/mastery.mjs && node tests/technical.mjs && node tests/card-manifest.mjs`

- [ ] **Step 5: Commit**

```bash
git add storage.js tests/technical.mjs
git commit -m "feat: add cache-only ttsAudio store, keep it out of backups"
```

---

### Task 2: `tts.js` — shared cache-key algorithm (pure helpers)

**Files:**
- Create: `tts.js`
- Test: `tests/tts-cache.mjs`

**Interfaces:**
- Produces: `normalizeSpeechText(text: string): string`, `roundRatePercent(rate: number): number`, `computeCacheKey(text: string, voice: string, rate: number): Promise<string>` (64-char lowercase hex sha256).
- Consumes: nothing (pure, uses only `crypto.subtle` and `TextEncoder`, both available in Node and browsers).

- [ ] **Step 1: Write the failing test**

Create `tests/tts-cache.mjs`:

```js
import assert from "node:assert/strict";
import { computeCacheKey, normalizeSpeechText, roundRatePercent } from "../tts.js";

assert.equal(normalizeSpeechText("bonjour"), "bonjour");
assert.equal(normalizeSpeechText("bonjour\n/bɔ̃.ʒuʁ/"), "bonjour", "text after the first newline (IPA line) must be dropped");
assert.equal(normalizeSpeechText("  très   bien  "), "très bien", "whitespace must be trimmed and collapsed");

assert.equal(roundRatePercent(1), 0);
assert.equal(roundRatePercent(0.82), -20);
assert.equal(roundRatePercent(1.1), 10);
assert.equal(roundRatePercent(0.55), -45);

const keyA = await computeCacheKey("Bonjour !", "fr-FR-DeniseNeural", 0.82);
const keyB = await computeCacheKey("Bonjour !", "fr-FR-DeniseNeural", 0.82);
assert.equal(keyA, keyB, "same input must produce the same cache key");
assert.match(keyA, /^[0-9a-f]{64}$/, "cache key must be a lowercase sha256 hex digest");

const keyDifferentVoice = await computeCacheKey("Bonjour !", "fr-FR-HenriNeural", 0.82);
assert.notEqual(keyA, keyDifferentVoice, "different voice must change the cache key");

const keyWithIpaLine = await computeCacheKey("Bonjour !\n/bɔ̃.ʒuʁ/", "fr-FR-DeniseNeural", 0.82);
assert.equal(keyA, keyWithIpaLine, "a trailing IPA line must not affect the cache key");

console.log("tts-cache.mjs OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/tts-cache.mjs`
Expected: FAIL — `Cannot find module '../tts.js'`.

- [ ] **Step 3: Implement tts.js (pure helpers only for now)**

Create `tts.js`:

```js
export function normalizeSpeechText(text) {
  const firstLine = String(text).split("\n")[0];
  return firstLine.split(/\s+/).filter(Boolean).join(" ");
}

export function roundRatePercent(rate) {
  const percent = (Number(rate) - 1) * 100;
  return Math.round(percent / 5) * 5;
}

export async function computeCacheKey(text, voice, rate) {
  const payload = `${normalizeSpeechText(text)}|${voice}|${roundRatePercent(rate)}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/tts-cache.mjs`
Expected: prints `tts-cache.mjs OK` and exits 0.

- [ ] **Step 5: Commit**

```bash
git add tts.js tests/tts-cache.mjs
git commit -m "feat: add shared TTS cache-key algorithm"
```

---

### Task 3: `server.py` — static file server + `/tts` endpoint with disk cache

**Files:**
- Create: `server.py`
- Test: `tests/test_server.py`

**Interfaces:**
- Produces: `normalize_text(text: str) -> str`, `round_rate_percent(rate: float) -> int`, `cache_key(text: str, voice: str, rate: float) -> str` (must match `tts.js`'s algorithm byte-for-byte), `synthesize(text: str, voice: str, rate: float) -> bytes` (async, calls `edge_tts`), `CACHE_DIR: Path` (module-level, monkeypatchable), `VOICES: set[str]`, `Handler` (`http.server.SimpleHTTPRequestHandler` subclass), `ThreadingHTTPServer` (re-exported from `http.server` for tests to use as `server.ThreadingHTTPServer`).
- Consumes: `edge_tts` (optional; `None` if not installed).

- [ ] **Step 1: Write the failing test**

Create `tests/test_server.py`:

```python
import http.client
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402


class TtsEndpointTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self._original_cache_dir = server.CACHE_DIR
        server.CACHE_DIR = Path(self.tmpdir.name)
        self._original_synthesize = server.synthesize
        server.synthesize = AsyncMock(return_value=b"FAKE-AUDIO-BYTES")
        self.httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        server.CACHE_DIR = self._original_cache_dir
        server.synthesize = self._original_synthesize
        self.tmpdir.cleanup()

    def request(self, path):
        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        conn.request("GET", path)
        response = conn.getresponse()
        body = response.read()
        conn.close()
        return response, body

    def test_synthesizes_and_caches_on_disk(self):
        response, body = self.request("/tts?text=Bonjour&voice=fr-FR-DeniseNeural&rate=0.82")
        self.assertEqual(response.status, 200)
        self.assertEqual(body, b"FAKE-AUDIO-BYTES")
        self.assertEqual(server.synthesize.await_count, 1)

        response2, body2 = self.request("/tts?text=Bonjour&voice=fr-FR-DeniseNeural&rate=0.82")
        self.assertEqual(response2.status, 200)
        self.assertEqual(body2, b"FAKE-AUDIO-BYTES")
        self.assertEqual(
            server.synthesize.await_count, 1,
            "second request for the same text/voice/rate must hit the disk cache, not synthesize again"
        )

    def test_rejects_unknown_voice(self):
        response, body = self.request("/tts?text=Bonjour&voice=not-a-real-voice&rate=1")
        self.assertEqual(response.status, 400)
        self.assertIn("error", json.loads(body))

    def test_returns_502_when_synthesis_fails(self):
        server.synthesize.side_effect = RuntimeError("boom")
        response, body = self.request("/tts?text=Bonjour&voice=fr-FR-DeniseNeural&rate=1")
        self.assertEqual(response.status, 502)
        self.assertIn("error", json.loads(body))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 tests/test_server.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'server'`.

- [ ] **Step 3: Implement server.py**

Create `server.py`:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 tests/test_server.py`
Expected: `OK` (3 tests passed).

- [ ] **Step 5: Commit**

```bash
git add server.py tests/test_server.py
git commit -m "feat: add local TTS proxy server with disk cache"
```

---

### Task 4: `scripts/prewarm_tts.py` — batch pre-synthesis for lesson content

**Files:**
- Create: `scripts/prewarm_tts.py`
- Test: `tests/test_prewarm.py`

**Interfaces:**
- Produces: `collect_texts(data: dict) -> list[str]` (sorted, deduplicated), `prewarm(data: dict, audio_dir=AUDIO_DIR, voice=VOICE, rate=RATE) -> dict` (async; returns and writes the manifest), `VOICE = "fr-FR-DeniseNeural"`, `RATE = 0.82`, `AUDIO_DIR: Path`.
- Consumes: `server.cache_key`, `server.synthesize` (module-qualified calls, so tests can monkeypatch `server.synthesize`).

- [ ] **Step 1: Write the failing test**

Create `tests/test_prewarm.py`:

```python
import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))
import server  # noqa: E402
import prewarm_tts  # noqa: E402


class CollectTextsTests(unittest.TestCase):
    def test_collects_every_speakable_field(self):
        data = {
            "lessons": [{
                "targetPhrase": "Bonjour, merci.",
                "dialogue": [{"fr": "Bonjour !"}, {"fr": "Merci beaucoup."}],
                "vocabulary": [{"fr": "bonjour"}, {"fr": "merci"}]
            }],
            "pronunciationTopics": [{"target": "bonjour, merci, très, rue"}]
        }
        texts = prewarm_tts.collect_texts(data)
        self.assertEqual(
            texts,
            sorted({
                "Bonjour, merci.", "Bonjour !", "Merci beaucoup.",
                "bonjour", "merci", "bonjour, merci, très, rue"
            })
        )

    def test_deduplicates_repeated_text(self):
        data = {
            "lessons": [{
                "targetPhrase": "bonjour",
                "dialogue": [{"fr": "bonjour"}],
                "vocabulary": [{"fr": "bonjour"}]
            }],
            "pronunciationTopics": []
        }
        self.assertEqual(prewarm_tts.collect_texts(data), ["bonjour"])


class PrewarmManifestTests(unittest.TestCase):
    def test_writes_manifest_matching_cache_key(self):
        data = {
            "lessons": [{"targetPhrase": "Bonjour !", "dialogue": [], "vocabulary": []}],
            "pronunciationTopics": []
        }
        original_synthesize = server.synthesize
        server.synthesize = AsyncMock(return_value=b"FAKE-AUDIO-BYTES")
        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                audio_dir = Path(tmpdir)
                manifest = asyncio.run(prewarm_tts.prewarm(data, audio_dir=audio_dir))
                key = server.cache_key("Bonjour !", prewarm_tts.VOICE, prewarm_tts.RATE)
                self.assertIn(key, manifest)
                self.assertEqual((audio_dir / manifest[key]).read_bytes(), b"FAKE-AUDIO-BYTES")
                written_manifest = json.loads((audio_dir / "manifest.json").read_text(encoding="utf-8"))
                self.assertEqual(written_manifest, manifest)
        finally:
            server.synthesize = original_synthesize


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 tests/test_prewarm.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'prewarm_tts'`.

- [ ] **Step 3: Implement scripts/prewarm_tts.py**

Create `scripts/prewarm_tts.py`:

```python
#!/usr/bin/env python3
import asyncio
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

import server  # noqa: E402

LESSONS_PATH = REPO_ROOT / "data" / "lessons.json"
AUDIO_DIR = REPO_ROOT / "data" / "audio"
VOICE = "fr-FR-DeniseNeural"
RATE = 0.82


def collect_texts(data):
    texts = set()
    for lesson in data["lessons"]:
        texts.add(lesson["targetPhrase"])
        for line in lesson["dialogue"]:
            texts.add(line["fr"])
        for item in lesson["vocabulary"]:
            texts.add(item["fr"])
    for topic in data["pronunciationTopics"]:
        texts.add(topic["target"])
    return sorted(text for text in texts if text.strip())


async def prewarm(data, audio_dir=AUDIO_DIR, voice=VOICE, rate=RATE):
    audio_dir.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for text in collect_texts(data):
        key = server.cache_key(text, voice, rate)
        filename = f"{key}.mp3"
        path = audio_dir / filename
        if not path.exists():
            print(f"Synthesizing: {text}")
            audio = await server.synthesize(text, voice, rate)
            path.write_bytes(audio)
        manifest[key] = filename
    (audio_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8"
    )
    return manifest


def main():
    try:
        import edge_tts  # noqa: F401
    except ImportError:
        print("edge-tts is required to prewarm audio. Install with: pip install edge-tts", file=sys.stderr)
        sys.exit(1)
    data = json.loads(LESSONS_PATH.read_text(encoding="utf-8"))
    manifest = asyncio.run(prewarm(data))
    print(f"Prewarmed {len(manifest)} phrases into {AUDIO_DIR}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 tests/test_prewarm.py`
Expected: `OK` (3 tests passed).

- [ ] **Step 5: Commit**

```bash
git add scripts/prewarm_tts.py tests/test_prewarm.py
git commit -m "feat: add lesson-content TTS prewarm script"
```

---

### Task 5: `tts.js` — runtime `speakFrench` (manifest, IndexedDB cache, live fetch, fallback)

**Files:**
- Modify: `tts.js` (extends the file from Task 2)

**Interfaces:**
- Produces: `speakFrench(text: string, { voice: string, rate: number }): Promise<void>`, `speakFrenchFallback(text: string, rate: number): void`.
- Consumes: `computeCacheKey`, `normalizeSpeechText` (from Task 2, same file), `getRecord`, `putRecord` from `storage.js` (existing exports, `ttsAudio` store from Task 1).

This task has no new automated test: it depends on `window`, `fetch`, `Audio`, and `crypto.subtle` together, which only make sense exercised in a real browser. Task 6/7 verify it end-to-end in the browser. The already-covered pure helpers keep their Task 2 test passing.

- [ ] **Step 1: Extend tts.js**

Add to the top of `tts.js` (new import) and the bottom (new exports), keeping the Task 2 functions unchanged:

```js
import { getRecord, putRecord } from "./storage.js";

const TTS_STORE = "ttsAudio";
const MANIFEST_URL = "data/audio/manifest.json";
const AUDIO_BASE_URL = "data/audio/";

let manifestPromise = null;
let currentAudio = null;

function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(MANIFEST_URL)
      .then((response) => (response.ok ? response.json() : {}))
      .catch(() => ({}));
  }
  return manifestPromise;
}

export async function speakFrench(text, { voice, rate }) {
  const key = await computeCacheKey(text, voice, rate);

  const manifest = await loadManifest();
  if (manifest[key]) {
    playUrl(`${AUDIO_BASE_URL}${manifest[key]}`);
    return;
  }

  const cached = await getRecord(TTS_STORE, key);
  if (cached?.blob) {
    playBlob(cached.blob);
    return;
  }

  const normalized = normalizeSpeechText(text);
  try {
    const params = new URLSearchParams({ text: normalized, voice, rate: String(rate) });
    const response = await fetch(`/tts?${params.toString()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    await putRecord(TTS_STORE, { id: key, blob, text: normalized, voice, rate, createdAt: new Date().toISOString() });
    playBlob(blob);
  } catch (error) {
    console.warn("[tts] live synthesis unavailable, falling back to the browser voice", error);
    speakFrenchFallback(text, rate);
  }
}

function playBlob(blob) {
  playUrl(URL.createObjectURL(blob), { revokeOnEnd: true });
}

function playUrl(url, { revokeOnEnd = false } = {}) {
  if (currentAudio) currentAudio.pause();
  const audio = new Audio(url);
  currentAudio = audio;
  if (revokeOnEnd) {
    audio.addEventListener("ended", () => URL.revokeObjectURL(url));
    audio.addEventListener("error", () => URL.revokeObjectURL(url));
  }
  audio.play().catch((error) => console.warn("[tts] playback failed", error));
}

export function speakFrenchFallback(text, rate) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(normalizeSpeechText(text));
  utterance.lang = "fr-FR";
  utterance.rate = rate;
  window.speechSynthesis.speak(utterance);
}
```

- [ ] **Step 2: Run the Task 2 test to confirm no regression**

Run: `node tests/tts-cache.mjs`
Expected: still prints `tts-cache.mjs OK` (the new browser-only code isn't exercised by this test and mustn't break the pure exports).

- [ ] **Step 3: Commit**

```bash
git add tts.js
git commit -m "feat: implement runtime speakFrench with manifest/IndexedDB/live-fetch/fallback"
```

---

### Task 6: `app.js` — wire the new TTS module into the UI

**Files:**
- Modify: `app.js:41-65` (state), `app.js:78` (constants), `app.js:83-115` (`init`), `app.js:394-413` (`renderSettings`), `app.js:974-1000` (voice helpers + `speakFrench`), `app.js:1566` (`defaultSettings`)

**Interfaces:**
- Consumes: `speakFrench` from `tts.js` (Task 5).
- Produces: nothing new — `speakFrench(text)` keeps its existing single-argument signature for all 5 existing call sites (`app.js:472,675,774,815,836`), now implemented as a thin wrapper around `tts.js`.

No new automated test — this task is UI wiring in a file with no existing unit tests (app.js is the entry point, never imported by `tests/*.mjs`). Verify manually in the browser per Step 5 below and in Task 7's full checklist.

- [ ] **Step 1: Add the import and the fixed voice list**

At the top of `app.js`, add to the existing import block (after the `storage.js` import, `app.js:22-34`):

```js
import { speakFrench as synthesizeFrench } from "./tts.js";
```

Add near the other top-level constants (`app.js:78`, right after `const MAX_BACKUP_FILE_BYTES = ...`):

```js
const VOICE_OPTIONS = [
  { id: "fr-FR-DeniseNeural", label: "Denise (женский)" },
  { id: "fr-FR-HenriNeural", label: "Henri (мужской)" }
];
```

- [ ] **Step 2: Remove `state.voices` and reset invalid stored voice ids in `init`**

In the `state` object (`app.js:41-65`), delete the line `voices: [],`.

In `init()`, replace:

```js
    state.settings = { ...defaultSettings(), ...(await getValue("settings", {})) };
```

with:

```js
    state.settings = { ...defaultSettings(), ...(await getValue("settings", {})) };
    if (!VOICE_OPTIONS.some((option) => option.id === state.settings.voiceURI)) {
      state.settings.voiceURI = defaultSettings().voiceURI;
    }
```

Remove these two lines from `init()` (`app.js:112-113`):

```js
    refreshVoices();
    window.speechSynthesis?.addEventListener?.("voiceschanged", refreshVoices);
```

- [ ] **Step 3: Replace `renderSettings`'s voice picker**

Replace `app.js:394-413`:

```js
function renderSettings() {
  const voiceOptions = state.voices.map((voice) => `
    <option value="${escapeHtml(voice.voiceURI)}" ${voice.voiceURI === state.settings.voiceURI ? "selected" : ""}>
      ${escapeHtml(voice.name)} · ${escapeHtml(voice.lang)}${voice.localService ? " · локальный" : ""}
    </option>`).join("");
  app.innerHTML = `
    <div class="settings-layout">
      <section class="section-band">
        <div class="section-heading"><div><p class="eyebrow">Произношение</p><h4>Французский голос</h4></div></div>
        <label class="field-label">Голос
          <select class="select-control full-control" id="voice-select">
            ${voiceOptions || `<option value="">Французские голоса пока не найдены</option>`}
          </select>
        </label>
        <label class="field-label">Скорость: <output id="voice-rate-output">${state.settings.voiceRate.toFixed(2)}</output>
          <input id="voice-rate" type="range" min="0.55" max="1.1" step="0.05" value="${state.settings.voiceRate}" />
        </label>
        <button class="secondary-button" type="button" id="test-voice">Прослушать пример</button>
        <p class="note">Кабинет использует выбранный голос macOS. Дополнительные французские голоса можно бесплатно установить в системных настройках Mac.</p>
      </section>
```

with:

```js
function renderSettings() {
  const voiceOptions = VOICE_OPTIONS.map((voice) => `
    <option value="${escapeHtml(voice.id)}" ${voice.id === state.settings.voiceURI ? "selected" : ""}>
      ${escapeHtml(voice.label)}
    </option>`).join("");
  app.innerHTML = `
    <div class="settings-layout">
      <section class="section-band">
        <div class="section-heading"><div><p class="eyebrow">Произношение</p><h4>Французский голос</h4></div></div>
        <label class="field-label">Голос
          <select class="select-control full-control" id="voice-select">
            ${voiceOptions}
          </select>
        </label>
        <label class="field-label">Скорость: <output id="voice-rate-output">${state.settings.voiceRate.toFixed(2)}</output>
          <input id="voice-rate" type="range" min="0.55" max="1.1" step="0.05" value="${state.settings.voiceRate}" />
        </label>
        <button class="secondary-button" type="button" id="test-voice">Прослушать пример</button>
        <p class="note">Голос синтезируется локальным TTS-сервером (бесплатные neural-голоса). После первого прослушивания фраза или своё слово играются из кэша без обращения к сети.</p>
      </section>
```

(The rest of `renderSettings`, from the "Локальные данные" section onward, is unchanged.)

- [ ] **Step 4: Replace the voice helpers and `speakFrench` implementation**

Replace `app.js:974-1000` (`refreshVoices`, `voicePriority`, `speakFrench`) with:

```js
function speakFrench(text) {
  return synthesizeFrench(text, { voice: state.settings.voiceURI, rate: state.settings.voiceRate });
}
```

- [ ] **Step 5: Update `defaultSettings`**

Replace `app.js:1566`:

```js
  return { voiceURI: "", voiceRate: 0.82, newCardsPerDay: 10 };
```

with:

```js
  return { voiceURI: "fr-FR-DeniseNeural", voiceRate: 0.82, newCardsPerDay: 10 };
```

- [ ] **Step 6: Run the full JS test suite to confirm no regression**

Run: `node tests/smoke.mjs && node tests/exercises.mjs && node tests/mastery.mjs && node tests/technical.mjs && node tests/card-manifest.mjs && node tests/tts-cache.mjs`
Expected: all pass, no output on the ones that only assert (per existing convention), `tts-cache.mjs OK` printed.

- [ ] **Step 7: Manual browser smoke check**

This step needs Task 7's `server.py` to be running (see Task 7) — if Task 7 hasn't run yet, start it manually: `python3 server.py`. Open `http://localhost:5173`, go to any lesson, click a "Прослушать" button. Confirm no console error and (once Task 7's prewarmed `data/audio/manifest.json` exists) that a `data/audio/*.mp3` request appears in the network tab rather than `/tts`.

- [ ] **Step 8: Commit**

```bash
git add app.js
git commit -m "feat: wire lesson/vocabulary audio through tts.js, drop system-voice picker"
```

---

### Task 7: Prewarm real audio, update docs, verify end-to-end in the browser

**Files:**
- Modify: `README.md`
- Modify: `.gitignore`
- Create (generated): `data/audio/*.mp3`, `data/audio/manifest.json`

**Interfaces:** none — this task produces committed static assets and documentation, and performs manual verification.

- [ ] **Step 1: Ignore the runtime disk cache**

Add a line to `.gitignore` (create the file with this content if it doesn't already exist, otherwise append):

```
.tts-cache/
```

Do **not** ignore `data/audio/` — those files are the committed pre-generated lesson audio.

- [ ] **Step 2: Install edge-tts and run the prewarm script**

```bash
pip3 install edge-tts
python3 scripts/prewarm_tts.py
```

Expected: prints one `Synthesizing: ...` line per unique lesson phrase/dialogue line/vocabulary word/pronunciation target, then `Prewarmed N phrases into .../data/audio`. This requires network access (reaches Microsoft's public Edge TTS endpoint) — if network access isn't available in the current environment, note this explicitly and leave it as a manual follow-up step for the user to run locally before relying on prewarmed audio; the app still works without it (everything routes through the live `/tts` fallback path from Task 5).

- [ ] **Step 3: Update README.md**

In the "Запуск" section, replace:

```bash
python3 -m http.server 5173
```

with:

```bash
python3 server.py
```

and add directly below the existing `localhost` paragraph:

> Своя озвучка française использует бесплатные neural-голоса через `edge-tts` (`pip install edge-tts`, необязательно). Без установленного пакета фразы из уроков всё равно звучат — они озвучены заранее и лежат в `data/audio/`; без сети/пакета озвучиваются на лету только свои слова, и делает это временно браузерный голос вместо neural.

In the "Структура" section, add these bullets (in the existing alphabetical/logical grouping, near `storage.js`):

```markdown
- `server.py` - локальный сервер: отдаёт статику и эндпоинт `/tts` (бесплатный neural TTS через `edge-tts`, с дисковым кэшем).
- `tts.js` - озвучка на фронтенде: заранее сгенерированные файлы урока, кэш в IndexedDB для остального, откат на браузерный голос при недоступности сервера.
- `scripts/prewarm_tts.py` - разовая генерация `data/audio/*.mp3` и `data/audio/manifest.json` из `data/lessons.json`.
- `data/audio/` - заранее озвученные фразы уроков (голос Denise, коммитится в git).
```

In the "Проверка" section, add:

```bash
node tests/tts-cache.mjs
python3 tests/test_server.py
python3 tests/test_prewarm.py
```

- [ ] **Step 4: Manual end-to-end browser verification**

Start the server: `python3 server.py`. Open `http://localhost:5173` and check each of the following, watching the Network tab:

1. Open a lesson, click "Прослушать" on a dialogue line. Expect a request to `data/audio/<hash>.mp3` (not `/tts`), audio plays.
2. Go to "Словарь", add a new custom word, click its ▶ button. Expect a `/tts` request, audio plays. Click the same button again — expect **no** second `/tts` request (served from the IndexedDB `ttsAudio` cache).
3. Stop `server.py` (Ctrl+C), click any "Прослушать" button for text that isn't in the manifest. Expect a console warning (`[tts] live synthesis unavailable...`) and the browser's own `speechSynthesis` voice still plays — no crash, no dead button.
4. Restart `server.py`, go to Настройки, switch the voice to Henri, click "Прослушать пример". Expect a `/tts` request with `voice=fr-FR-HenriNeural`.

If any check fails, fix the underlying code (not this checklist) before proceeding.

- [ ] **Step 5: Commit**

```bash
git add .gitignore README.md data/audio
git commit -m "docs: switch run instructions to server.py, commit prewarmed lesson audio"
```
