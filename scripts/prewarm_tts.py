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
A2_LESSONS_PATH = REPO_ROOT / "data" / "a2" / "course.json"
PRONUNCIATION_PATH = REPO_ROOT / "data" / "pronunciation-course.json"
AUDIO_DIR = REPO_ROOT / "data" / "audio"
VOICE = "fr-FR-DeniseNeural"
RATE = 0.82
LOCAL_MACOS_VOICE = "Flo"
LOCAL_MACOS_VOICES = {
    "fr-FR-DeniseNeural": "Flo",
    "fr-FR-HenriNeural": "Thomas",
}
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


def collect_audio_items(data, pronunciation_data=None, default_voice=VOICE):
    items = set()

    def add(text, voice=default_voice):
        if str(text or "").strip():
            items.add((str(text), voice))

    for lesson in data["lessons"]:
        add(lesson["targetPhrase"])
        for line in lesson["dialogue"]:
            add(line["fr"])
        for item in lesson["vocabulary"]:
            add(item["fr"])
        for exercise in lesson.get("exercises", []):
            if exercise.get("listenText"):
                add(exercise["listenText"])
            if exercise.get("transcript"):
                add(exercise["transcript"])
            for turn in exercise.get("audioScene", []):
                add(turn.get("text", ""), turn.get("voice", default_voice))
            if is_recording_required(exercise) and exercise.get("modelAnswer"):
                add(exercise["modelAnswer"])
        for card in lesson.get("cards", []):
            text = card_audio_text(card)
            add(text)
    for topic in data["pronunciationTopics"]:
        add(topic["target"])
    if pronunciation_data:
        for lesson in pronunciation_data.get("lessons", []):
            for example in lesson.get("examples", []):
                add(example.get("text", ""))
            for card in lesson.get("cards", []):
                add(card.get("audioText", ""))
            for spelling in lesson.get("spellings", []):
                if spelling.get("soundText"):
                    add(spelling["soundText"])
                if spelling.get("examples"):
                    add(spelling["examples"])
    return sorted(items)


def collect_texts(data, pronunciation_data=None):
    return sorted({text for text, _voice in collect_audio_items(data, pronunciation_data)})


def merge_course_catalogs(*catalogs):
    return {
        "lessons": [lesson for catalog in catalogs for lesson in catalog.get("lessons", [])],
        "pronunciationTopics": [topic for catalog in catalogs for topic in catalog.get("pronunciationTopics", [])],
    }


def local_macos_rate(rate):
    return max(80, round(200 * float(rate)))


def synthesize_with_macos(text, voice, rate):
    if sys.platform != "darwin":
        raise RuntimeError("Локальная генерация доступна только на macOS.")
    if shutil.which("say") is None or shutil.which("ffmpeg") is None:
        raise RuntimeError("Для локальной генерации нужны системный say и ffmpeg.")

    local_voice = LOCAL_MACOS_VOICES.get(voice, LOCAL_MACOS_VOICE)
    with tempfile.TemporaryDirectory(prefix="french-study-tts-") as temporary_directory:
        workdir = Path(temporary_directory)
        source_path = workdir / "speech.aiff"
        target_path = workdir / "speech.mp3"
        say_result = subprocess.run(
            ["say", "-v", local_voice, "-r", str(local_macos_rate(rate)), "-o", str(source_path), text],
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


async def prewarm(data, audio_dir=AUDIO_DIR, voice=VOICE, rate=RATE, synthesizer=None, replace_texts=None, pronunciation_data=None):
    if synthesizer is None:
        synthesizer = server.synthesize
    replace_texts = set(replace_texts or [])
    audio_dir.mkdir(parents=True, exist_ok=True)
    manifest = {}
    available_items = collect_audio_items(data, pronunciation_data, voice)
    available_texts = {text for text, _item_voice in available_items}
    unknown_texts = replace_texts.difference(available_texts)
    if unknown_texts:
        raise ValueError(f"Нет таких фраз в курсе: {', '.join(sorted(unknown_texts))}")

    for text, item_voice in available_items:
        key = server.cache_key(text, item_voice, rate)
        filename = f"{key}.mp3"
        path = audio_dir / filename
        if text in replace_texts or not path.exists():
            print(f"Synthesizing [{item_voice}]: {text}")
            audio = await synthesizer(text, item_voice, rate)
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
    parser.add_argument(
        "--replace-text",
        action="append",
        default=[],
        metavar="TEXT",
        help="Regenerate one current course phrase, even if its MP3 already exists. May be repeated.",
    )
    args = parser.parse_args()
    synthesizer = synthesize_locally
    source = f"локальные голоса macOS {', '.join(sorted(set(LOCAL_MACOS_VOICES.values())))}"
    if not args.local_macos:
        try:
            import edge_tts  # noqa: F401
        except ImportError:
            print("edge-tts is required for online audio. Use --local-macos for offline generation.", file=sys.stderr)
            sys.exit(1)
        synthesizer = server.synthesize
        source = "Edge TTS"
    data = merge_course_catalogs(
        json.loads(LESSONS_PATH.read_text(encoding="utf-8")),
        json.loads(A2_LESSONS_PATH.read_text(encoding="utf-8")),
    )
    pronunciation_data = json.loads(PRONUNCIATION_PATH.read_text(encoding="utf-8"))
    manifest = asyncio.run(prewarm(
        data,
        synthesizer=synthesizer,
        replace_texts=args.replace_text,
        pronunciation_data=pronunciation_data
    ))
    print(f"Prewarmed {len(manifest)} phrases into {AUDIO_DIR} using {source}")


if __name__ == "__main__":
    main()
