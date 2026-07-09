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
