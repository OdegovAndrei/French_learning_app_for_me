#!/usr/bin/env python3
import asyncio
import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

import server  # noqa: E402

LESSONS_PATH = REPO_ROOT / "data" / "lessons.json"
AUDIO_DIR = REPO_ROOT / "data" / "audio"
VOICE = "fr-FR-DeniseNeural"
RATE = 0.82
LOCAL_MACOS_VOICE = "Flo"
LOCAL_MP3_BITRATE = "96k"
CLOZE_PATTERN = re.compile(r"\{\{c\d+::(.*?)(?:::.+?)?\}\}")
RECORDING_EXERCISE_TYPES = {"speaking", "roleplay", "conversation-prompt", "recorded-monologue"}


def is_recording_required(exercise):
    if exercise.get("requiresRecording") is False:
        return False
    return exercise.get("type") in RECORDING_EXERCISE_TYPES


def card_audio_text(card):
    front = str(card.get("front", ""))
    back = str(card.get("back", ""))
    source = back if re.search(r"[À-ÿA-Za-z]", back) else front
    return CLOZE_PATTERN.sub(r"\1", source)


def collect_texts(data):
    texts = set()
    for lesson in data["lessons"]:
        texts.add(lesson["targetPhrase"])
        for line in lesson["dialogue"]:
            texts.add(line["fr"])
        for item in lesson["vocabulary"]:
            texts.add(item["fr"])
        for exercise in lesson.get("exercises", []):
            if exercise.get("listenText"):
                texts.add(exercise["listenText"])
            if exercise.get("transcript"):
                texts.add(exercise["transcript"])
            if is_recording_required(exercise) and exercise.get("modelAnswer"):
                texts.add(exercise["modelAnswer"])
        for card in lesson.get("cards", []):
            text = card_audio_text(card)
            if text.strip():
                texts.add(text)
    for topic in data["pronunciationTopics"]:
        texts.add(topic["target"])
    return sorted(text for text in texts if text.strip())


def local_macos_rate(rate):
    return max(80, round(200 * float(rate)))


def synthesize_with_macos(text, voice, rate):
    if sys.platform != "darwin":
        raise RuntimeError("Локальная генерация доступна только на macOS.")
    if shutil.which("say") is None or shutil.which("ffmpeg") is None:
        raise RuntimeError("Для локальной генерации нужны системный say и ffmpeg.")

    with tempfile.TemporaryDirectory(prefix="french-study-tts-") as temporary_directory:
        workdir = Path(temporary_directory)
        source_path = workdir / "speech.aiff"
        target_path = workdir / "speech.mp3"
        say_result = subprocess.run(
            ["say", "-v", LOCAL_MACOS_VOICE, "-r", str(local_macos_rate(rate)), "-o", str(source_path), text],
            capture_output=True,
            text=True,
            check=False,
        )
        if say_result.returncode != 0 or not source_path.exists() or source_path.stat().st_size <= 4096:
            raise RuntimeError(f"macOS не смог создать озвучку: {say_result.stderr.strip() or 'нет аудиоданных'}")

        ffmpeg_result = subprocess.run(
            [
                "ffmpeg", "-y", "-loglevel", "error", "-i", str(source_path),
                "-codec:a", "libmp3lame", "-b:a", LOCAL_MP3_BITRATE, str(target_path),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if ffmpeg_result.returncode != 0 or not target_path.exists() or not target_path.stat().st_size:
            raise RuntimeError(f"ffmpeg не смог преобразовать озвучку: {ffmpeg_result.stderr.strip() or 'нет MP3'}")
        return target_path.read_bytes()


async def synthesize_locally(text, voice, rate):
    return await asyncio.to_thread(synthesize_with_macos, text, voice, rate)


async def prewarm(data, audio_dir=AUDIO_DIR, voice=VOICE, rate=RATE, synthesizer=None):
    if synthesizer is None:
        synthesizer = server.synthesize
    audio_dir.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for text in collect_texts(data):
        key = server.cache_key(text, voice, rate)
        filename = f"{key}.mp3"
        path = audio_dir / filename
        if not path.exists():
            print(f"Synthesizing: {text}")
            audio = await synthesizer(text, voice, rate)
            path.write_bytes(audio)
        manifest[key] = filename
    (audio_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8"
    )
    return manifest


def main():
    parser = argparse.ArgumentParser(description="Pre-generate French Study audio files.")
    parser.add_argument(
        "--local-macos",
        action="store_true",
        help="Use the locally installed macOS French voice instead of an external TTS service.",
    )
    args = parser.parse_args()
    synthesizer = synthesize_locally
    source = f"локальный голос macOS {LOCAL_MACOS_VOICE}"
    if not args.local_macos:
        try:
            import edge_tts  # noqa: F401
        except ImportError:
            print("edge-tts is required for online audio. Use --local-macos for offline generation.", file=sys.stderr)
            sys.exit(1)
        synthesizer = server.synthesize
        source = "Edge TTS"
    data = json.loads(LESSONS_PATH.read_text(encoding="utf-8"))
    manifest = asyncio.run(prewarm(data, synthesizer=synthesizer))
    print(f"Prewarmed {len(manifest)} phrases into {AUDIO_DIR} using {source}")


if __name__ == "__main__":
    main()
