import assert from "node:assert/strict";
import { computeCacheKey, normalizeSpeechText, roundRatePercent, selectBrowserVoice, speakFrench, speakFrenchFallback } from "../tts.js";

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

const browserVoices = [
  { name: "Thomas", lang: "fr-FR" },
  { name: "Amélie", lang: "fr-FR" },
  { name: "Samantha", lang: "en-US" }
];
assert.equal(selectBrowserVoice(browserVoices, "fr-FR-DeniseNeural")?.name, "Amélie", "Denise must use a female French browser fallback");
assert.equal(selectBrowserVoice(browserVoices, "fr-FR-HenriNeural")?.name, "Thomas", "Henri must use a male French browser fallback");
assert.equal(selectBrowserVoice([{ name: "Thomas", lang: "fr-FR" }], "fr-FR-DeniseNeural"), null, "Do not replace Denise with a mismatched male fallback");

const originalWindow = globalThis.window;
const originalUtterance = globalThis.SpeechSynthesisUtterance;
const spoken = [];
try {
  globalThis.window = {
    speechSynthesis: {
      getVoices: () => [{ name: "Thomas", lang: "fr-FR" }],
      cancel: () => {},
      speak: (utterance) => spoken.push(utterance)
    }
  };
  globalThis.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  assert.equal(speakFrenchFallback("une carte", 0.82, "fr-FR-DeniseNeural"), true);
  assert.equal(spoken.length, 1, "A French browser default must speak when the selected voice is unavailable");
  assert.equal(spoken[0].text, "une carte");
  assert.equal(spoken[0].lang, "fr-FR");
  assert.equal(spoken[0].voice, undefined, "The browser must choose its own French default voice");
} finally {
  globalThis.window = originalWindow;
  globalThis.SpeechSynthesisUtterance = originalUtterance;
}

const originalFetch = globalThis.fetch;
const originalAudio = globalThis.Audio;
const recoveredSpeech = [];
const brokenAudioKey = await computeCacheKey("des informations", "fr-FR-DeniseNeural", 0.82);
try {
  globalThis.window = {
    speechSynthesis: {
      getVoices: () => [{ name: "Amélie", lang: "fr-FR" }],
      cancel: () => {},
      speak: (utterance) => recoveredSpeech.push(utterance)
    }
  };
  globalThis.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ [brokenAudioKey]: "broken.mp3" })
  });
  globalThis.Audio = class {
    addEventListener() {}
    pause() {}
    play() {
      return Promise.reject(new Error("cannot decode MP3"));
    }
  };
  await speakFrench("des informations", { voice: "fr-FR-DeniseNeural", rate: 0.82 });
  await Promise.resolve();
  assert.equal(recoveredSpeech.length, 1, "A failed pre-generated MP3 must fall back to browser speech");
  assert.equal(recoveredSpeech[0].text, "des informations");
} finally {
  globalThis.fetch = originalFetch;
  globalThis.Audio = originalAudio;
  globalThis.window = originalWindow;
  globalThis.SpeechSynthesisUtterance = originalUtterance;
}

console.log("tts-cache.mjs OK");
