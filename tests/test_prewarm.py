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

    def test_collects_exercise_listen_text_and_transcript(self):
        data = {
            "lessons": [{
                "targetPhrase": "Bonjour.",
                "dialogue": [],
                "vocabulary": [],
                "exercises": [
                    {
                        "type": "listening-comprehension",
                        "listenText": "Le train part à dix heures.",
                        "transcript": "Le train part à dix heures."
                    },
                    {"type": "dictation", "transcript": "Le magasin est ouvert."}
                ]
            }],
            "pronunciationTopics": []
        }
        texts = prewarm_tts.collect_texts(data)
        self.assertEqual(
            texts,
            sorted({"Bonjour.", "Le train part à dix heures.", "Le magasin est ouvert."})
        )

    def test_collects_french_review_card_audio(self):
        data = {
            "lessons": [{
                "targetPhrase": "Bonjour.",
                "dialogue": [],
                "vocabulary": [],
                "cards": [
                    {"front": "Я иду домой.", "back": "Je rentre chez moi."},
                    {"front": "Je vais au {{c1::marché}}.", "back": "рынок"}
                ]
            }],
            "pronunciationTopics": []
        }
        self.assertEqual(
            prewarm_tts.collect_texts(data),
            sorted({"Bonjour.", "Je rentre chez moi.", "Je vais au marché."})
        )

    def test_collects_independent_pronunciation_course_audio(self):
        data = {"lessons": [], "pronunciationTopics": []}
        pronunciation_data = {
            "lessons": [{
                "examples": [{"text": "loup"}, {"text": "bateau"}],
                "cards": [{"audioText": "loup, où"}]
            }]
        }

        self.assertEqual(
            prewarm_tts.collect_texts(data, pronunciation_data),
            ["bateau", "loup", "loup, où"]
        )


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

    def test_replaces_only_requested_existing_text(self):
        data = {
            "lessons": [{
                "targetPhrase": "Bonjour !",
                "dialogue": [{"fr": "Au revoir !"}],
                "vocabulary": []
            }],
            "pronunciationTopics": []
        }
        synthesizer = AsyncMock(return_value=b"REGENERATED")
        with tempfile.TemporaryDirectory() as tmpdir:
            audio_dir = Path(tmpdir)
            for text in prewarm_tts.collect_texts(data):
                key = server.cache_key(text, prewarm_tts.VOICE, prewarm_tts.RATE)
                (audio_dir / f"{key}.mp3").write_bytes(f"OLD:{text}".encode())

            manifest = asyncio.run(prewarm_tts.prewarm(
                data,
                audio_dir=audio_dir,
                synthesizer=synthesizer,
                replace_texts={"Bonjour !"}
            ))

            self.assertEqual(synthesizer.await_count, 1)
            synthesizer.assert_awaited_once_with("Bonjour !", prewarm_tts.VOICE, prewarm_tts.RATE)
            bonjour_key = server.cache_key("Bonjour !", prewarm_tts.VOICE, prewarm_tts.RATE)
            farewell_key = server.cache_key("Au revoir !", prewarm_tts.VOICE, prewarm_tts.RATE)
            self.assertEqual((audio_dir / manifest[bonjour_key]).read_bytes(), b"REGENERATED")
            self.assertEqual((audio_dir / manifest[farewell_key]).read_bytes(), b"OLD:Au revoir !")


if __name__ == "__main__":
    unittest.main()
