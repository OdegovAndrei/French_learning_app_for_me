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
