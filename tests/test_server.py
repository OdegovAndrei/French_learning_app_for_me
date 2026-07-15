import http.client
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402


class TtsEndpointTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self._original_cache_dir = server.CACHE_DIR
        server.CACHE_DIR = Path(self.tmpdir.name)
        self._original_storage_file = server.STORAGE_FILE
        server.STORAGE_FILE = Path(self.tmpdir.name) / "user-data" / "french-study-data.json"
        self._original_synthesize = server.synthesize
        server.synthesize = AsyncMock(return_value=b"FAKE-AUDIO-BYTES")
        self._original_transcribe_audio = server.transcribe_audio
        server.transcribe_audio = Mock(return_value="Bonjour, je m'appelle Léa.")
        self.httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        server.CACHE_DIR = self._original_cache_dir
        server.STORAGE_FILE = self._original_storage_file
        server.synthesize = self._original_synthesize
        server.transcribe_audio = self._original_transcribe_audio
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

    def test_file_storage_initializes_and_applies_atomic_transactions(self):
        response, payload = self.request_json("GET", "/api/storage")
        self.assertEqual(response.status, 200)
        self.assertFalse(payload["exists"])
        self.assertIsNone(payload["snapshot"])

        initial = self.storage_snapshot("l01")
        response, payload = self.request_json(
            "PUT",
            "/api/storage",
            {"snapshot": initial, "initializeOnly": True}
        )
        self.assertEqual(response.status, 200)
        self.assertTrue(payload["created"])
        self.assertEqual(payload["snapshot"]["stores"]["kv"][0]["value"]["completedLessons"], ["l01"])
        self.assertTrue(server.STORAGE_FILE.exists())

        transaction = {
            "puts": [
                {"store": "kv", "record": {"key": "settings", "value": {"newCardsPerDay": 20}}},
                {"store": "exercises", "record": {"id": "exercise:1", "answer": "Bonjour"}}
            ],
            "deletes": [],
            "clearStores": []
        }
        response, payload = self.request_json("POST", "/api/storage/transaction", transaction)
        self.assertEqual(response.status, 200)
        self.assertTrue(payload["saved"])
        self.assertTrue(server.STORAGE_FILE.with_name("french-study-data.backup.json").exists())

        saved = json.loads(server.STORAGE_FILE.read_text(encoding="utf-8"))
        self.assertEqual(saved["stores"]["exercises"], [{"id": "exercise:1", "answer": "Bonjour"}])
        self.assertEqual(
            next(record for record in saved["stores"]["kv"] if record["key"] == "settings")["value"]["newCardsPerDay"],
            20
        )

    def test_initialize_only_and_second_port_share_the_same_file(self):
        first = self.storage_snapshot("l01")
        second = self.storage_snapshot("l02")
        response, _ = self.request_json("PUT", "/api/storage", {"snapshot": first, "initializeOnly": True})
        self.assertEqual(response.status, 200)
        response, payload = self.request_json("PUT", "/api/storage", {"snapshot": second, "initializeOnly": True})
        self.assertEqual(response.status, 200)
        self.assertFalse(payload["created"])
        self.assertEqual(payload["snapshot"]["stores"]["kv"][0]["value"]["completedLessons"], ["l01"])

        second_server = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        second_port = second_server.server_address[1]
        second_thread = threading.Thread(target=second_server.serve_forever, daemon=True)
        second_thread.start()
        try:
            response, payload = self.request_json("GET", "/api/storage", port=second_port)
            self.assertEqual(response.status, 200)
            self.assertEqual(payload["snapshot"]["stores"]["kv"][0]["value"]["completedLessons"], ["l01"])
        finally:
            second_server.shutdown()
            second_server.server_close()
            second_thread.join(timeout=2)

    def test_storage_file_is_not_served_as_a_static_asset(self):
        for path in [
            "/user-data/french-study-data.json",
            "/%75ser-data/french-study-data.json",
            "/assets/../user-data/french-study-data.json"
        ]:
            response, _ = self.request(path)
            self.assertEqual(response.status, 404)

    def test_interface_files_are_not_cached(self):
        for path in ["/", "/app.js", "/styles.css", "/data/lessons.json"]:
            response, _ = self.request(path)
            self.assertEqual(response.status, 200)
            self.assertEqual(response.getheader("Cache-Control"), "no-store, max-age=0")

    def test_storage_rejects_unknown_stores(self):
        response, payload = self.request_json(
            "POST",
            "/api/storage/transaction",
            {"puts": [{"store": "secrets", "record": {"id": "nope"}}]}
        )
        self.assertEqual(response.status, 400)
        self.assertIn("error", payload)

    def test_transcribes_a_saved_recording_locally(self):
        response, body = self.request_with_body("/stt", b"FAKE-WEBM", "audio/webm")
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(body), {"transcript": "Bonjour, je m'appelle Léa."})
        server.transcribe_audio.assert_called_once_with(b"FAKE-WEBM", "audio/webm")

    def test_rejects_stt_without_an_audio_recording(self):
        response, body = self.request_with_body("/stt", b"", "audio/webm")
        self.assertEqual(response.status, 400)
        self.assertIn("error", json.loads(body))

    def request_with_body(self, path, body, content_type):
        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        conn.request("POST", path, body=body, headers={"Content-Type": content_type})
        response = conn.getresponse()
        response_body = response.read()
        conn.close()
        return response, response_body

    def request_json(self, method, path, payload=None, port=None):
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {} if body is None else {"Content-Type": "application/json"}
        conn = http.client.HTTPConnection("127.0.0.1", port or self.port)
        conn.request(method, path, body=body, headers=headers)
        response = conn.getresponse()
        response_body = response.read()
        conn.close()
        return response, json.loads(response_body)

    @staticmethod
    def storage_snapshot(completed_lesson):
        snapshot = server.empty_storage_snapshot()
        snapshot["stores"]["kv"].append({
            "key": "appState",
            "value": {"completedLessons": [completed_lesson]}
        })
        return snapshot


if __name__ == "__main__":
    unittest.main()
