# Remove new-card note-pairing throttle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `buildReviewQueue` from deferring a word's second review direction to tomorrow just because its sibling direction was already introduced today or is due today.

**Architecture:** Single pure-function change in `srs.js`. `buildReviewQueue` currently tracks a `selectedNotes` set (seeded from `due` cards' `noteId`s plus `introducedNotes` from today's logs) and refuses to queue any new card whose `noteId` is already in that set. Replace it with a `newNoteIds` set that only tracks which notes have *consumed a daily slot*, so both directions of a note can be queued together while a pair still only costs one slot.

**Tech Stack:** Plain ES modules (`srs.js`), Node's built-in `node:assert/strict` test style (`tests/smoke.mjs`), run via `node tests/smoke.mjs` (no test framework/runner).

## Global Constraints

- `buildReviewQueue`'s external signature (`{ cards, schedules, logs, now, newLimit, cram, seen }` → array of cards) must not change — callers in `app.js` (lines 389 and 400) are unaffected.
- `newCardsPerDay` ("Новых слов в день" in Настройки) continues to mean distinct words: a two-card pair (ru-fr + fr-ru) must consume exactly one slot, never two.
- No settings/UI toggle is being added — this is a straight behavior change, not an option (YAGNI, per approved spec).
- Spec of record: [docs/superpowers/specs/2026-07-11-new-card-note-pairing-design.md](../specs/2026-07-11-new-card-note-pairing-design.md).

---

### Task 1: Remove the note-pairing throttle from `buildReviewQueue`

**Files:**
- Modify: `srs.js:138-171` (the `buildReviewQueue` function)
- Modify: `tests/smoke.mjs:426-451` (existing assertions that encode the old "siblings stay buried" behavior)
- Test: `tests/smoke.mjs` (same file — this repo has no separate test/impl file split; assertions live inline in the script)

**Interfaces:**
- Consumes: existing exports from `srs.js` already imported at the top of `tests/smoke.mjs` — `buildReviewQueue`, `createSchedule`, `createScheduler`, `previewSchedule`, `reviewSchedule` — plus the existing top-level `cards` (from `buildCards(data)`, `tests/smoke.mjs:142`), `now` (`tests/smoke.mjs:416`), `firstSchedule` (`tests/smoke.mjs:417`) fixtures. No new imports needed.
- Produces: `buildReviewQueue` keeps its exact current signature and return shape (an ordered array of card objects, `due` cards first then `newCards`). Nothing downstream of this task depends on new exports.

- [ ] **Step 1: Update the existing queue-composition assertions to expect paired directions**

In `tests/smoke.mjs`, find:

```js
const queue = buildReviewQueue({
  cards,
  schedules: new Map(),
  logs: [],
  now,
  newLimit: 10,
  cram: false,
  seen: new Set()
});
assert.equal(queue.length, 10, "Only ten new cards should be introduced per day");
assert.equal(new Set(queue.map((card) => card.noteId)).size, queue.length, "Sibling directions are buried");
```

Replace with:

```js
const queue = buildReviewQueue({
  cards,
  schedules: new Map(),
  logs: [],
  now,
  newLimit: 10,
  cram: false,
  seen: new Set()
});
assert.equal(new Set(queue.map((card) => card.noteId)).size, 10, "Only ten distinct new words should be introduced per day");
assert.equal(queue.length, 20, "Both directions of each of the ten new words are queued together");
```

(`cards` is built from the full `data.lessons` fixture, which has far more than ten vocabulary notes, each contributing an adjacent `ru-fr`/`fr-ru` pair — see `cardsFromVocabularyNote` in `cards.js:56-70` and `buildCards`'s `notes.flatMap(cardsFromVocabularyNote)` in `cards.js:21`. With no existing schedules, the first ten distinct notes encountered in `cards` order each contribute both cards, so the queue holds 20 cards across 10 notes.)

- [ ] **Step 2: Update the due/sibling assertion that encodes the old burial behavior**

Immediately below, find:

```js
const firstCardSibling = cards.find((card) => card.noteId === cards[0].noteId && card.id !== cards[0].id);
const firstCardAfterGood = reviewSchedule(firstSchedule, "good", now, createScheduler({ enable_fuzz: false }));
const tenMinutesLater = new Date(now.getTime() + 10 * 60 * 1000);
const queueWithShortRepeat = buildReviewQueue({
  cards,
  schedules: new Map([[cards[0].id, firstCardAfterGood.schedule]]),
  logs: [{ cardId: cards[0].id, wasNew: true, reviewedAt: now.toISOString() }],
  now: tenMinutesLater,
  newLimit: 10,
  cram: false,
  seen: new Set()
});
assert.equal(queueWithShortRepeat[0].id, cards[0].id, "A card due after ten minutes must return today");
assert.ok(!queueWithShortRepeat.some((card) => card.id === firstCardSibling.id), "The sibling direction stays buried while the note is learning");
```

Replace the last line only:

```js
const firstCardSibling = cards.find((card) => card.noteId === cards[0].noteId && card.id !== cards[0].id);
const firstCardAfterGood = reviewSchedule(firstSchedule, "good", now, createScheduler({ enable_fuzz: false }));
const tenMinutesLater = new Date(now.getTime() + 10 * 60 * 1000);
const queueWithShortRepeat = buildReviewQueue({
  cards,
  schedules: new Map([[cards[0].id, firstCardAfterGood.schedule]]),
  logs: [{ cardId: cards[0].id, wasNew: true, reviewedAt: now.toISOString() }],
  now: tenMinutesLater,
  newLimit: 10,
  cram: false,
  seen: new Set()
});
assert.equal(queueWithShortRepeat[0].id, cards[0].id, "A card due after ten minutes must return today");
assert.ok(
  queueWithShortRepeat.some((card) => card.id === firstCardSibling.id),
  "The sibling direction is no longer excluded just because the note already has a due/learning card today"
);
```

- [ ] **Step 3: Add a small controlled-fixture test for the one-slot-per-pair invariant**

Directly after the block from Step 2 (still before the `overdue`/`queueWithAgainPriority` block), add:

```js
const pairedCards = [
  { id: "p:a:ru-fr", noteId: "p:a", source: "builtIn", kind: "ru-fr", front: "chat", back: "кот", lessonId: "l01", lessonTitle: "Урок 1" },
  { id: "p:a:fr-ru", noteId: "p:a", source: "builtIn", kind: "fr-ru", front: "кот", back: "chat", lessonId: "l01", lessonTitle: "Урок 1" },
  { id: "p:b:ru-fr", noteId: "p:b", source: "builtIn", kind: "ru-fr", front: "chien", back: "собака", lessonId: "l01", lessonTitle: "Урок 1" },
  { id: "p:b:fr-ru", noteId: "p:b", source: "builtIn", kind: "fr-ru", front: "собака", back: "chien", lessonId: "l01", lessonTitle: "Урок 1" }
];
const pairedQueue = buildReviewQueue({
  cards: pairedCards,
  schedules: new Map(),
  logs: [],
  now,
  newLimit: 1,
  cram: false,
  seen: new Set()
});
assert.equal(pairedQueue.length, 2, "A one-word daily budget still admits both directions of that single word");
assert.deepEqual(
  new Set(pairedQueue.map((card) => card.noteId)),
  new Set(["p:a"]),
  "Only the first note's pair is admitted; the second note's pair waits for tomorrow"
);
```

- [ ] **Step 4: Run the test file and confirm it fails against the current implementation**

Run: `node tests/smoke.mjs`

Expected: `AssertionError` thrown from the `assert.equal(queue.length, 20, ...)` line added in Step 1 (current code still returns 10, one per note, since the old `selectedNotes` logic is still in place). The script should stop there — later assertions (Steps 2 and 3) won't even run yet since this one throws first.

- [ ] **Step 5: Replace `buildReviewQueue` in `srs.js`**

In `srs.js`, find the full function (lines 138-171):

```js
export function buildReviewQueue({ cards, schedules, logs, now = new Date(), newLimit = 10, cram = false, seen = new Set() }) {
  const active = cards;
  if (cram) return active.filter((card) => !seen.has(card.id));

  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const due = active
    .filter((card) => isDueSchedule(schedules.get(card.id), now))
    .sort((a, b) => {
      const aSchedule = schedules.get(a.id);
      const bSchedule = schedules.get(b.id);
      const priorityDifference = Number(isLearningSchedule(bSchedule)) - Number(isLearningSchedule(aSchedule));
      if (priorityDifference) return priorityDifference;
      const skippedDifference = Number(seen.has(a.id)) - Number(seen.has(b.id));
      if (skippedDifference) return skippedDifference;
      return new Date(aSchedule.due) - new Date(bSchedule.due);
    });

  const introducedNotes = introducedNoteIdsToday(logs, cardsById, now);
  const introduced = countNewIntroducedToday(logs, cardsById, now);
  const slots = Math.max(0, newLimit - introduced);
  const newCards = [];
  const selectedNotes = new Set([...due.map((card) => card.noteId), ...introducedNotes]);

  for (const card of active) {
    if (newCards.length >= slots) break;
    if (seen.has(card.id)) continue;
    if (!isNewSchedule(schedules.get(card.id))) continue;
    if (selectedNotes.has(card.noteId)) continue;
    newCards.push(card);
    selectedNotes.add(card.noteId);
  }

  return [...due, ...newCards];
}
```

Replace with:

```js
export function buildReviewQueue({ cards, schedules, logs, now = new Date(), newLimit = 10, cram = false, seen = new Set() }) {
  const active = cards;
  if (cram) return active.filter((card) => !seen.has(card.id));

  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const due = active
    .filter((card) => isDueSchedule(schedules.get(card.id), now))
    .sort((a, b) => {
      const aSchedule = schedules.get(a.id);
      const bSchedule = schedules.get(b.id);
      const priorityDifference = Number(isLearningSchedule(bSchedule)) - Number(isLearningSchedule(aSchedule));
      if (priorityDifference) return priorityDifference;
      const skippedDifference = Number(seen.has(a.id)) - Number(seen.has(b.id));
      if (skippedDifference) return skippedDifference;
      return new Date(aSchedule.due) - new Date(bSchedule.due);
    });

  const introduced = countNewIntroducedToday(logs, cardsById, now);
  const slots = Math.max(0, newLimit - introduced);
  const newCards = [];
  const newNoteIds = new Set();

  for (const card of active) {
    if (seen.has(card.id)) continue;
    if (!isNewSchedule(schedules.get(card.id))) continue;
    if (!newNoteIds.has(card.noteId)) {
      if (newNoteIds.size >= slots) continue;
      newNoteIds.add(card.noteId);
    }
    newCards.push(card);
  }

  return [...due, ...newCards];
}
```

After this edit, `introducedNoteIdsToday` (`srs.js:128-136`, just above `buildReviewQueue`) has no remaining callers anywhere in the codebase (confirmed via `grep -rn "introducedNoteIdsToday" srs.js app.js tests/*.mjs` — the only two hits were its own definition and the now-removed call site). Delete the function entirely:

```js
export function introducedNoteIdsToday(logs, cardsById, now = new Date()) {
  const day = localDateKey(now);
  return new Set(
    logs
      .filter((log) => log.wasNew && localDateKey(new Date(log.reviewedAt)) === day)
      .map((log) => cardsById.get(log.cardId)?.noteId)
      .filter(Boolean)
  );
}
```

`countNewIntroducedToday` (directly above it, `srs.js:119-126`) is unrelated and still used — leave it untouched.

- [ ] **Step 6: Run the test file and confirm everything passes**

Run: `node tests/smoke.mjs`

Expected output ends with:
```
Smoke tests passed: 38 lessons, <N> exercises, <M> cards.
```
with no `AssertionError` thrown anywhere in the run.

- [ ] **Step 7: Run the full test suite to confirm no other file regressed**

Run each in sequence:
```bash
node tests/smoke.mjs
node tests/exercises.mjs
node tests/mastery.mjs
node tests/technical.mjs
node tests/card-manifest.mjs
node tests/tts-cache.mjs
```

Expected: every command exits 0 with no thrown `AssertionError`. (None of these files import `buildReviewQueue` other than `smoke.mjs`, confirmed via `grep -rln "buildReviewQueue" tests/` beforehand returning only `tests/smoke.mjs` — this step is a regression guard, not expected to surface new failures.)

- [ ] **Step 8: Commit**

```bash
git add srs.js tests/smoke.mjs
git commit -m "fix: stop burying a word's second review direction for a full day"
```

---

## Post-implementation check against the spec

- Both directions of a new note can appear the same day when slots allow — covered by Step 1's updated queue assertion and Step 3's `pairedQueue` fixture.
- A pair consumes exactly one slot — covered by Step 3 (`newLimit: 1` admits both cards of note `p:a`, none of `p:b`).
- A new card is no longer excluded just because a due card shares its `noteId` — covered by Step 2's updated `queueWithShortRepeat` assertion.
- `cram` mode's early-return line is untouched by the Step 5 diff, so its behavior can't regress from this change (no dedicated test exists for it in this suite either way — out of scope here).
- The `seen`/due-ordering behavior (Again-priority, skip-to-back-of-queue) is untouched by the Step 5 diff — Step 7 reruns the existing assertions later in `tests/smoke.mjs` (`queueWithAgainPriority`, `queueWithAgainMarkedSeen`, `queueWithSkippedDue`, `allSixteenMarkedSeen`, `queueWithDue`) to confirm nothing regressed.
