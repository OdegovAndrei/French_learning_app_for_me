# RU/FR Direction Split in Повторение Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the mixed RU→FR/FR→RU review queue in the Повторение screen into two mandatory direction modes, so a user practices one translation direction at a time regardless of which deck (Все карточки/Слова/Фразы/Свои/lesson) is selected.

**Architecture:** Add a pure `filterCardsByDirection(cards, direction)` function in `cards.js` that resolves each card's effective direction (vocabulary cards via `.kind`, phrase cards via `.direction`, cloze cards have no direction of their own). Wire it into `app.js`'s `renderReview()` as a second filter applied after the existing deck filter, driven by a new `state.reviewDirection` field. Add a segmented UI control (matching the existing "Режим повторения" control) to switch it.

**Tech Stack:** Vanilla JS (ES modules), no framework, no test runner — tests are linear Node scripts using `node:assert/strict`, run directly with `node tests/<file>.mjs`.

## Global Constraints

- No mixed/"both directions" option remains — `state.reviewDirection` is always exactly `"ru-fr"` or `"fr-ru"`.
- Default value: `"ru-fr"`. Not persisted across reloads (matches `reviewMode`/`reviewDeck`, which are also in-memory-only `state` fields).
- Cloze cards (`card.kind === "cloze"`, `card.direction === null`) have no translation direction of their own — they must appear only under `"ru-fr"` and never under `"fr-ru"`.
- The standalone Фразы browsing screen (`renderPhrases()` in `app.js`) is out of scope — do not modify it. It keeps showing both directions' schedule status per row, as today.
- The new direction control must stay visible and interactive in all three review modes (Повторение / Зубрёжка / Все слова), unlike the deck `<select id="review-deck">`, which is already hidden while `state.reviewMode === "words"`.
- Spec: [docs/superpowers/specs/2026-07-12-review-direction-split-design.md](../specs/2026-07-12-review-direction-split-design.md)

---

### Task 1: `filterCardsByDirection` in `cards.js`

**Files:**
- Modify: `cards.js` (add function next to `filterCards`, currently at [cards.js:130-136](../../../cards.js#L130-L136))
- Test: `tests/smoke.mjs` (extends the existing `buildCards`/`filterCards` coverage; import line at [tests/smoke.mjs:4](../../../tests/smoke.mjs#L4), phrase-direction assertions end at [tests/smoke.mjs:171](../../../tests/smoke.mjs#L171))

**Interfaces:**
- Produces: `export function filterCardsByDirection(cards, direction)` from `cards.js`. `direction` is `"ru-fr"` or `"fr-ru"`. Returns the subset of `cards` (same order, same object references) belonging to that direction, per the rule: vocabulary cards route by `card.kind` (`"ru-fr"`/`"fr-ru"`), phrase cards route by `card.direction`, cards with no direction (`card.direction` falsy, i.e. cloze cards) are included only when `direction === "ru-fr"`.

- [ ] **Step 1: Write the failing tests**

Edit `tests/smoke.mjs` line 4 to add the new import:

```js
import { buildCards, buildVocabularyNotes, filterCards, filterCardsByDirection, normalizeCardText } from "../cards.js";
```

Insert the following block right after the existing dialogue-phrase-pair loop, i.e. immediately after line 171 (`assert.equal(new Set(pair.map((card) => card.noteId)).size, 1, "Phrase directions share one FSRS note budget");` closes the `for (const phrase of dialoguePhrases)` loop) and before the `const legacyVocabularyIds = [` block:

```js
const ruFrDirectionCards = filterCardsByDirection(cards, "ru-fr");
const frRuDirectionCards = filterCardsByDirection(cards, "fr-ru");
assert.equal(
  ruFrDirectionCards.length + frRuDirectionCards.length,
  cards.length,
  "Every card must fall into exactly one direction bucket"
);
assert.ok(
  cards.filter((card) => card.kind === "ru-fr").every((card) => ruFrDirectionCards.includes(card)),
  "Vocabulary ru-fr cards must appear in the ru-fr bucket"
);
assert.ok(
  cards.filter((card) => card.kind === "fr-ru").every((card) => frRuDirectionCards.includes(card)),
  "Vocabulary fr-ru cards must appear in the fr-ru bucket"
);
const clozeCards = cards.filter((card) => card.kind === "cloze");
assert.ok(clozeCards.length > 0, "The catalog must contain cloze cards to exercise the direction split");
assert.ok(
  clozeCards.every((card) => ruFrDirectionCards.includes(card)),
  "Cloze cards have no direction of their own and must surface under ru-fr"
);
assert.ok(
  clozeCards.every((card) => !frRuDirectionCards.includes(card)),
  "Cloze cards must not surface under fr-ru"
);
const phraseNoteDirections = new Map();
for (const card of cards.filter((card) => card.kind === "phrase")) {
  if (!phraseNoteDirections.has(card.noteId)) phraseNoteDirections.set(card.noteId, new Set());
  phraseNoteDirections.get(card.noteId).add(card.direction);
}
const singleDirectionNote = [...phraseNoteDirections.entries()].find(([, directions]) => directions.size === 1);
assert.ok(singleDirectionNote, "Fixture data must include at least one phrase note with only one generated direction");
const [singleNoteId, singleDirections] = singleDirectionNote;
const [onlyDirection] = singleDirections;
const otherDirection = onlyDirection === "ru-fr" ? "fr-ru" : "ru-fr";
assert.ok(
  filterCardsByDirection(cards, onlyDirection).some((card) => card.noteId === singleNoteId),
  "A phrase note with a single generated direction must appear under that direction"
);
assert.ok(
  !filterCardsByDirection(cards, otherDirection).some((card) => card.noteId === singleNoteId),
  "A phrase note with a single generated direction must not appear under the other direction"
);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/smoke.mjs`
Expected: throws a `SyntaxError` (or `TypeError`) because `filterCardsByDirection` is not exported from `cards.js` yet — e.g. `SyntaxError: The requested module '../cards.js' does not provide an export named 'filterCardsByDirection'`.

- [ ] **Step 3: Implement `filterCardsByDirection`**

In `cards.js`, add this immediately after the existing `filterCards` function (after line 136):

```js
export function filterCardsByDirection(cards, direction) {
  return cards.filter((card) => {
    const cardDirection = card.kind === "ru-fr" || card.kind === "fr-ru" ? card.kind : card.direction;
    if (!cardDirection) return direction === "ru-fr";
    return cardDirection === direction;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/smoke.mjs`
Expected: exits with no output and status code 0 (matches how every other assertion in this file behaves — no test runner, just uncaught exceptions on failure).

- [ ] **Step 5: Commit**

```bash
git add cards.js tests/smoke.mjs
git commit -m "feat: add filterCardsByDirection to split cards by translation direction"
```

---

### Task 2: Wire the direction filter into `renderReview` state

**Files:**
- Modify: `app.js` — import list ([app.js:2-9](../../../app.js#L2-L9)), `state` object ([app.js:47-75](../../../app.js#L47-L75)), `renderReview()` ([app.js:413-469](../../../app.js#L413-L469))
- Test: `tests/technical.mjs` (source-regex assertions on `app.js`, following the existing convention at [tests/technical.mjs:111-117](../../../tests/technical.mjs#L111-L117))

**Interfaces:**
- Consumes: `filterCardsByDirection(cards, direction)` from Task 1 (`cards.js`).
- Produces: `state.reviewDirection` (`"ru-fr"` | `"fr-ru"`, default `"ru-fr"`), and `renderReview()`'s `deckCards` now reflects both the deck filter and the direction filter. Task 3's UI reads/writes `state.reviewDirection` and calls `renderReview()`.

- [ ] **Step 1: Write the failing tests**

In `tests/technical.mjs`, right after the existing block ending at line 117 (`assert.match(appSource, /window\.addEventListener\("pagehide"[\s\S]*?flushPendingSaves\(\)/);`), add:

```js
assert.match(appSource, /reviewDirection: "ru-fr"/, "state must default to ru-fr direction");
assert.match(
  appSource,
  /const deckCards = filterCardsByDirection\(filterCards\(allActive, state\.reviewDeck\), state\.reviewDirection\);/,
  "renderReview must filter deck cards by the selected direction"
);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/technical.mjs`
Expected: `AssertionError` — neither pattern is present in `app.js` yet.

- [ ] **Step 3: Implement the wiring**

In `app.js`, edit the `cards.js` import block (lines 2-9) to add `filterCardsByDirection`:

```js
import {
  buildCards,
  buildVocabularyNotes,
  cardsFromVocabularyNote,
  filterCards,
  filterCardsByDirection,
  renderClozeFront,
  revealCloze
} from "./cards.js";
```

In the `state` object, add `reviewDirection` right after `reviewDeck: "all",` (line 60):

```js
  reviewMode: "review",
  reviewDeck: "all",
  reviewDirection: "ru-fr",
```

In `renderReview()`, replace the existing deck-cards line (line 417):

```js
  const deckCards = filterCards(allActive, state.reviewDeck);
```

with:

```js
  const deckCards = filterCardsByDirection(filterCards(allActive, state.reviewDeck), state.reviewDirection);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/technical.mjs`
Expected: exits with status code 0, no output.

Also re-run Task 1's test to confirm no regression: `node tests/smoke.mjs` — expected status code 0.

- [ ] **Step 5: Commit**

```bash
git add app.js tests/technical.mjs
git commit -m "feat: filter the review deck by translation direction"
```

---

### Task 3: Direction toggle UI, toolbar binding, and manual verification

**Files:**
- Modify: `app.js` — `renderReview()` template ([app.js:443-455](../../../app.js#L443-L455)), `bindReviewToolbar()` ([app.js:876-891](../../../app.js#L876-L891))
- Test: `tests/technical.mjs` (source-regex assertions)

**Interfaces:**
- Consumes: `state.reviewDirection` (Task 2).
- Produces: two `[data-review-direction]` buttons in the review toolbar; clicking one sets `state.reviewDirection`, clears `state.reviewSeen`, resets `state.reviewAnswerVisible`, and re-renders — mirroring the existing `#review-deck` change handler at [app.js:885-890](../../../app.js#L885-L890).

- [ ] **Step 1: Write the failing tests**

In `tests/technical.mjs`, after the two assertions added in Task 2, add:

```js
assert.match(appSource, /data-review-direction="ru-fr"/, "review toolbar must render an RU→FR direction button");
assert.match(appSource, /data-review-direction="fr-ru"/, "review toolbar must render an FR→RU direction button");
assert.match(
  appSource,
  /document\.querySelectorAll\("\[data-review-direction\]"\)\.forEach\(\(button\) => \{[\s\S]*?state\.reviewDirection = button\.dataset\.reviewDirection;[\s\S]*?state\.reviewSeen\.clear\(\);[\s\S]*?renderReview\(\);/,
  "direction buttons must update state.reviewDirection, reset the seen set, and re-render"
);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/technical.mjs`
Expected: `AssertionError` — none of the three patterns exist in `app.js` yet.

- [ ] **Step 3: Add the segmented control markup**

In `renderReview()`'s template, the toolbar currently reads (lines 445-453):

```js
        <div class="segmented" aria-label="Режим повторения">
          <button type="button" data-review-mode="review" class="${state.reviewMode === "review" ? "active" : ""}">Повторение</button>
          <button type="button" data-review-mode="cram" class="${state.reviewMode === "cram" ? "active" : ""}">Зубрёжка</button>
          <button type="button" data-review-mode="words" class="${isWordsMode ? "active" : ""}">${isPhrasesDeck ? "Все фразы" : "Все слова"}</button>
        </div>
        ${isWordsMode ? "" : `
        <select id="review-deck" class="select-control" aria-label="Колода">
          ${renderDeckOptions()}
        </select>`}
```

Replace it with:

```js
        <div class="segmented" aria-label="Режим повторения">
          <button type="button" data-review-mode="review" class="${state.reviewMode === "review" ? "active" : ""}">Повторение</button>
          <button type="button" data-review-mode="cram" class="${state.reviewMode === "cram" ? "active" : ""}">Зубрёжка</button>
          <button type="button" data-review-mode="words" class="${isWordsMode ? "active" : ""}">${isPhrasesDeck ? "Все фразы" : "Все слова"}</button>
        </div>
        <div class="segmented" aria-label="Направление">
          <button type="button" data-review-direction="ru-fr" class="${state.reviewDirection === "ru-fr" ? "active" : ""}">RU → FR</button>
          <button type="button" data-review-direction="fr-ru" class="${state.reviewDirection === "fr-ru" ? "active" : ""}">FR → RU</button>
        </div>
        ${isWordsMode ? "" : `
        <select id="review-deck" class="select-control" aria-label="Колода">
          ${renderDeckOptions()}
        </select>`}
```

- [ ] **Step 4: Add the toolbar binding**

In `bindReviewToolbar()`, the function currently starts (lines 876-884):

```js
function bindReviewToolbar() {
  document.querySelectorAll("[data-review-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.reviewMode = button.dataset.reviewMode;
      state.reviewSeen.clear();
      state.reviewAnswerVisible = false;
      renderReview();
    });
  });
```

Add a matching block for direction right after it (still inside `bindReviewToolbar`, before the existing `document.querySelector("#review-deck")` handler):

```js
function bindReviewToolbar() {
  document.querySelectorAll("[data-review-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.reviewMode = button.dataset.reviewMode;
      state.reviewSeen.clear();
      state.reviewAnswerVisible = false;
      renderReview();
    });
  });
  document.querySelectorAll("[data-review-direction]").forEach((button) => {
    button.addEventListener("click", () => {
      state.reviewDirection = button.dataset.reviewDirection;
      state.reviewSeen.clear();
      state.reviewAnswerVisible = false;
      renderReview();
    });
  });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node tests/technical.mjs`
Expected: exits with status code 0, no output.

Also re-run the full existing suite to confirm no regressions, per README's "Проверка" section:

```bash
node tests/smoke.mjs
node tests/exercises.mjs
node tests/mastery.mjs
node tests/technical.mjs
node tests/card-manifest.mjs
node tests/tts-cache.mjs
```

Expected: every command exits with status code 0, no output.

- [ ] **Step 6: Commit**

```bash
git add app.js tests/technical.mjs
git commit -m "feat: add RU/FR direction toggle to the Повторение toolbar"
```

- [ ] **Step 7: Manually verify in the browser**

This is a UI change with no DOM-executing test harness in this repo (`technical.mjs` only regex-checks `app.js` source, per existing convention) — it must be exercised in a real browser before considering the feature done.

Start the dev server exactly as README's "Запуск" section describes:

```bash
.venv/bin/python server.py
```

This defaults to **port 5173** — do not use the `.claude/launch.json` "french-study" configuration, which is misconfigured to port 5174; this project's server always runs on 5173.

Open `http://localhost:5173`, then:

1. Navigate to "Повторение". Confirm a new "Направление" segmented control renders next to "Режим повторения" and the "Колода" dropdown, with "RU → FR" active by default.
2. With deck "Все карточки" and direction "RU → FR": step through several cards via "Показать ответ", confirming every front is either a Russian prompt or a cloze French sentence — no French-prompt/Russian-answer card appears.
3. Click "FR → RU". Confirm the queue visibly restarts (first card changes / counters update) and every front is now a French vocabulary/phrase prompt — no cloze cards and no Russian-prompt cards appear.
4. From the Фразы nav screen, click "Повторять фразы" while "FR → RU" is still selected from step 3. Confirm the review screen opens with deck "Фразы" and direction stays "FR → RU" (i.e. direction is not reset by the deck switch), showing only French→Russian phrase cards.
5. Switch to "Все слова"/"Все фразы" mode. Toggle between "RU → FR" and "FR → RU" and confirm the browsing table's rows change accordingly.
6. Navigate to the standalone "Фразы" nav screen (not via the review button). Confirm it is unchanged from before this feature — each row still lists both directions' schedule status.
7. Take a screenshot of the Повторение screen in each direction as evidence.

If any check fails, fix the underlying code (not the test regexes) and repeat from Step 1 of the relevant task.

---

## Self-Review Notes

- **Spec coverage:** State field/default (Task 2), filtering logic incl. cloze/single-direction phrase edge cases (Task 1, tested against real catalog data), UI placement/visibility across all three modes (Task 3), reset-on-switch behavior (Task 2's handler mirrors Task 3's new handler), standalone Фразы screen left untouched (explicitly called out as out-of-scope and manually checked in Task 3 Step 7.6) — all covered.
- **Placeholders:** none — every step has literal code/commands.
- **Type/name consistency:** `filterCardsByDirection(cards, direction)` signature is identical across Task 1's implementation, Task 2's call site, and the regex tests. `state.reviewDirection` name is identical across Tasks 2 and 3. `data-review-direction` attribute name is identical between the markup (Step 3) and the binding (Step 4).
