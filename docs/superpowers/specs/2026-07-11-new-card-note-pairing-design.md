# Design: remove per-note daily throttle on new-card pairs

## Problem

`buildReviewQueue` in [srs.js:138-171](../../../srs.js#L138-L171) selects which "new" (never-reviewed) cards join today's queue. It currently refuses to queue a new card whose `noteId` is already represented either by a `due` card today or by a note already introduced today (`introducedNotes`, tracked via `wasNew` review-log entries). Since every vocabulary note produces two cards — `ru-fr` and `fr-ru` — reviewing one direction today silently defers the other direction's first appearance to tomorrow, even when the daily new-word budget (`newCardsPerDay`, labeled "Новых слов в день" in Настройки) is nowhere near exhausted. This reads as a bug to the user: the "Все слова"/summary UI shows a nonzero `новых` count, but the queue is empty with a message blaming the daily limit, when the real blocker is the per-note-per-day pairing rule.

## Decision

Remove the per-note-per-day pairing restriction entirely. Both directions of a word can be queued as new on the same day, in no particular relative order — they simply land among the other new cards in whatever order `active` produces them (vocabulary cards before phrase cards; within vocabulary, per-note direction order as built by `cardsFromVocabularyNote`). No due-card exclusion either: a new card is no longer skipped just because another card sharing its `noteId` is due today.

The daily budget stays word-based, not card-based: `newCardsPerDay` continues to mean distinct words, so a freshly-introduced pair (`ru-fr` + `fr-ru`) consumes exactly one slot, not two.

## Implementation

Replace the `selectedNotes`-based loop in `buildReviewQueue` with one that tracks only which `noteId`s have consumed a slot:

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

Key differences from current code:
- `introducedNotes` (`introducedNoteIdsToday`) is no longer computed or consulted — dropped along with the `selectedNotes` union that mixed it with `due`'s note ids.
- The loop no longer breaks early on `newCards.length >= slots`; it must scan all of `active` since a later card can belong to a `noteId` already admitted (no slot cost) even after the slot budget is technically full for *new* notes.
- Slot accounting (`newNoteIds.size >= slots`) is per distinct note, so a two-card pair only ever costs one slot regardless of which direction is encountered first.

No changes to `isNewSchedule`, `isDueSchedule`, `countNewIntroducedToday`, or any caller signature — `buildReviewQueue`'s external interface (`app.js` call sites at [app.js:389](../../../app.js#L389) and [app.js:400](../../../app.js#L400)) is unaffected.

## Edge cases

- **Slot budget of 0** (`newCardsPerDay` reached for the day): behaves as today — no new cards admitted, only `due` returned.
- **A note whose two cards are far apart in `active`** (e.g. a custom word's `fr-ru` card added long after other notes' cards in iteration order): still only costs one slot the first time either of its cards is encountered; the second is admitted for free whenever it's reached, even past the slot cap.
- **cram mode**: unaffected, still returns all unseen active cards regardless of note pairing.

## Testing

Update/extend the `buildReviewQueue` unit tests (in [tests/mastery.mjs](../../../tests/mastery.mjs) or wherever existing `srs.js` queue-building coverage lives) to assert:
1. Both directions of a brand-new note can appear in the same `buildReviewQueue` result when slots allow.
2. A pair of new-card directions for the same note consumes exactly one slot (e.g. with `newLimit: 1` and two never-reviewed notes each with two cards, only one note's both cards should appear, not one card from each note).
3. A new card is no longer excluded just because a due card shares its `noteId` (previously blocked via the `due`-derived half of `selectedNotes`).

## Out of scope

- No settings/UI toggle to bring back the old pairing behavior (not requested; keeps the change minimal per YAGNI).
- No change to how `newCardsPerDay` is surfaced or labeled in Настройки.
- No change to ordering/grouping within the new-cards portion of the queue beyond what naturally falls out of removing the note-exclusion check.
