import assert from "node:assert/strict";
import { computeCacheKey, normalizeSpeechText, roundRatePercent, selectBrowserVoice } from "../tts.js";

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

console.log("tts-cache.mjs OK");
