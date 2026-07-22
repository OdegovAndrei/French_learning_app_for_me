import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, call

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "scripts"))
import server  # noqa: E402
import prewarm_tts  # noqa: E402


class CollectTextsTests(unittest.TestCase):
    def test_local_scene_voices_are_distinct(self):
        self.assertNotEqual(
            prewarm_tts.LOCAL_MACOS_VOICES["fr-FR-DeniseNeural"],
            prewarm_tts.LOCAL_MACOS_VOICES["fr-FR-HenriNeural"],
        )

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

    def test_collects_multivoice_scene_with_explicit_voices(self):
        data = {
            "lessons": [{
                "targetPhrase": "Bonjour.",
                "dialogue": [],
                "vocabulary": [],
                "exercises": [{
                    "type": "listening-comprehension",
                    "audioScene": [
                        {"text": "Bonjour Madame.", "voice": "fr-FR-HenriNeural"},
                        {"text": "Bonjour Monsieur.", "voice": "fr-FR-DeniseNeural"},
                    ],
                }],
            }],
            "pronunciationTopics": [],
        }
        items = prewarm_tts.collect_audio_items(data)
        self.assertIn(("Bonjour Madame.", "fr-FR-HenriNeural"), items)
        self.assertIn(("Bonjour Monsieur.", "fr-FR-DeniseNeural"), items)

    def test_merges_a1_and_a2_catalogs(self):
        merged = prewarm_tts.merge_course_catalogs(
            {"lessons": [{"id": "a1"}], "pronunciationTopics": [{"id": "p1"}]},
            {"lessons": [{"id": "a2"}], "pronunciationTopics": [{"id": "p2"}]},
        )
        self.assertEqual([lesson["id"] for lesson in merged["lessons"]], ["a1", "a2"])
        self.assertEqual([topic["id"] for topic in merged["pronunciationTopics"]], ["p1", "p2"])

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

    def test_collects_reading_table_sound_and_example_text(self):
        data = {"lessons": [], "pronunciationTopics": []}
        pronunciation_data = {
            "lessons": [{
                "spellings": [
                    {"pattern": "a, à, â", "sound": "[a]", "examples": "ami, là, âge", "soundText": "a, à, â"},
                    {"pattern": "c + a/o/u", "sound": "[k]", "examples": "café, code, culture", "soundText": "c"}
                ]
            }]
        }
        self.assertEqual(
            prewarm_tts.collect_texts(data, pronunciation_data),
            sorted({"a, à, â", "ami, là, âge", "c", "café, code, culture"})
        )


class PrewarmManifestTests(unittest.TestCase):
    def test_committed_manifest_covers_a1_a2_and_scene_voices(self):
        a1 = json.loads(prewarm_tts.LESSONS_PATH.read_text(encoding="utf-8"))
        a2 = json.loads(prewarm_tts.A2_LESSONS_PATH.read_text(encoding="utf-8"))
        pronunciation = json.loads(prewarm_tts.PRONUNCIATION_PATH.read_text(encoding="utf-8"))
        data = prewarm_tts.merge_course_catalogs(a1, a2)
        manifest = json.loads((prewarm_tts.AUDIO_DIR / "manifest.json").read_text(encoding="utf-8"))
        items = prewarm_tts.collect_audio_items(data, pronunciation)
        missing = []
        for text, voice in items:
            key = server.cache_key(text, voice, prewarm_tts.RATE)
            filename = manifest.get(key)
            if not filename or not (prewarm_tts.AUDIO_DIR / filename).is_file():
                missing.append((text, voice))
        self.assertEqual(missing, [])
        self.assertEqual(len(manifest), len(items))

    def test_prewarm_uses_each_scene_voice_in_the_cache_key(self):
        data = {
            "lessons": [{
                "targetPhrase": "Bonjour.",
                "dialogue": [],
                "vocabulary": [],
                "exercises": [{
                    "type": "listening-comprehension",
                    "audioScene": [
                        {"text": "Je confirme.", "voice": "fr-FR-DeniseNeural"},
                        {"text": "Merci.", "voice": "fr-FR-HenriNeural"},
                    ],
                }],
            }],
            "pronunciationTopics": [],
        }
        synthesizer = AsyncMock(return_value=b"AUDIO")
        with tempfile.TemporaryDirectory() as tmpdir:
            manifest = asyncio.run(prewarm_tts.prewarm(
                data,
                audio_dir=Path(tmpdir),
                synthesizer=synthesizer,
            ))
        synthesizer.assert_has_awaits([
            call("Je confirme.", "fr-FR-DeniseNeural", prewarm_tts.RATE),
            call("Merci.", "fr-FR-HenriNeural", prewarm_tts.RATE),
        ], any_order=True)
        self.assertIn(server.cache_key("Je confirme.", "fr-FR-DeniseNeural", prewarm_tts.RATE), manifest)
        self.assertIn(server.cache_key("Merci.", "fr-FR-HenriNeural", prewarm_tts.RATE), manifest)

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
