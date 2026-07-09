import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildCards } from "../cards.js";
import { LEGACY_CARD_MANIFEST, cardSemanticFingerprint } from "../legacy-card-manifest.js";

const raw = await readFile(new URL("../data/lessons.json", import.meta.url), "utf8");
const data = JSON.parse(raw);
const cards = buildCards(data);
const cardsById = new Map(cards.map((card) => [card.id, card]));
const legacyEntries = Object.entries(LEGACY_CARD_MANIFEST);

assert.equal(legacyEntries.length, 77, "Baseline d935566 must keep all 77 built-in card identities");

for (const [cardId, expectedFingerprint] of legacyEntries) {
  const current = cardsById.get(cardId);
  assert.ok(current, `Legacy card disappeared without a migration: ${cardId}`);
  assert.equal(
    cardSemanticFingerprint(current),
    expectedFingerprint,
    `Legacy card identity changed without a migration: ${cardId}`
  );
}

assert.ok(cards.length >= legacyEntries.length, "New cards may extend, but never replace, the legacy manifest");
assert.ok(cardsById.has("vocab:l06:a-gauche:ru-fr"), "The post-baseline à gauche card should remain additive");
assert.equal(LEGACY_CARD_MANIFEST["vocab:l06:a-gauche:ru-fr"], undefined, "New ids must not rewrite baseline history");

console.log(`Legacy card manifest passed: ${legacyEntries.length} protected identities, ${cards.length - legacyEntries.length} additive cards.`);
