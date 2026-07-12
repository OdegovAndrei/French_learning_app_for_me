import { getRecord, putRecord } from "./storage.js";

const TTS_STORE = "ttsAudio";
const MANIFEST_URL = "data/audio/manifest.json";
const AUDIO_BASE_URL = "data/audio/";

let manifestPromise = null;
let currentAudio = null;

const BROWSER_VOICE_NAME_HINTS = {
  "fr-FR-DeniseNeural": ["denise", "amélie", "amelie", "audrey", "aurélie", "aurelie", "marie", "céline", "celine", "julie", "sophie", "female", "feminine", "woman"],
  "fr-FR-HenriNeural": ["henri", "thomas", "mathieu", "rémi", "remi", "male", "masculine", "man"]
};

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
    speakFrenchFallback(text, rate, voice);
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

export function selectBrowserVoice(voices, requestedVoice) {
  const hints = BROWSER_VOICE_NAME_HINTS[requestedVoice] || [];
  if (!hints.length) return null;
  return voices.find((voice) => {
    if (!String(voice.lang || "").toLowerCase().startsWith("fr")) return false;
    const name = String(voice.name || "").toLowerCase();
    return hints.some((hint) => name.includes(hint));
  }) || null;
}

export function speakFrenchFallback(text, rate, requestedVoice = "fr-FR-DeniseNeural") {
  if (!window.speechSynthesis) return;
  const voice = selectBrowserVoice(window.speechSynthesis.getVoices(), requestedVoice);
  if (!voice) {
    console.warn(`[tts] no matching browser voice for ${requestedVoice}; suppressing a mismatched fallback voice`);
    return false;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(normalizeSpeechText(text));
  utterance.lang = voice.lang || "fr-FR";
  utterance.voice = voice;
  utterance.rate = rate;
  window.speechSynthesis.speak(utterance);
  return true;
}
