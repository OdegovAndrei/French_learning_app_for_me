# Design: "Все слова" tab in Повторение

## Problem

In the Повторение (review) screen, the user can only see the single card currently at the front of the queue. There's no way to see the full set of unlocked (already-introduced) words at once, or to check how long until each one reappears for review. The user wants a dedicated tab within Повторение that lists every unlocked word with its FSRS status and remaining time until next appearance.

## Scope

"Unlocked words" = all active cards, i.e. the result of the existing `getActiveCards()` helper in [app.js](../../../app.js): cards from introduced lessons plus custom words, excluding suspended cards/notes. This includes cards still in the `New` FSRS state (never reviewed) as well as cards in `Learning`/`Review`/`Relearning`.

The list always shows all active cards regardless of the deck selector (`state.reviewDeck`) — the deck filter only applies to the existing card-review/cram flow.

## UI placement

Add a third button to the existing segmented control in the review toolbar (`renderReview()` in [app.js:409-420](../../../app.js#L409-L420)):

```
Повторение | Зубрёжка | Все слова
```

- New mode value: `state.reviewMode = "words"`.
- Selecting it behaves like the existing mode switch (`bindReviewToolbar`): clears `state.reviewSeen`, resets `state.reviewAnswerVisible`, re-renders.

When `state.reviewMode === "words"`:
- The deck `<select id="review-deck">` and the `.review-counters` block (due/new/session counts) are hidden — they describe the card-review queue, which doesn't apply here.
- The card/empty-state area (`renderReviewCard` / `renderReviewEmpty`) is replaced by the new word list.
- `#review-add-word` button and the suspended-cards `<details>` (`renderSuspendedCards`) remain visible, unchanged.

## Data & sorting

A new pure helper, e.g. `buildUnlockedWordRows({ cards, schedules, now })` (added to `srs.js`, alongside the other schedule-related pure functions), returns an ordered list of row view-models. Pure/DOM-free so it's unit-testable without jsdom.

Grouping/ordering:
1. Cards are grouped by `lessonTitle`/lesson id, in course order — the same ordering already used for lesson tiles (`compareLessons` in [app.js](../../../app.js)). Custom words (`card.source === "custom"`) form a final group labeled "Свои слова".
2. Within each group, cards are sorted alphabetically by `front` (locale-aware, French).

Each row view-model carries: `id`, `front`, `back`, `groupLabel`, `statusLabel`, `remainingLabel`.

### Status label (from `schedule.state`)

| FSRS state | Label |
|---|---|
| `State.New` (or no schedule) | Новое |
| `State.Learning` | Изучение |
| `State.Review` | Повторение |
| `State.Relearning` | Переизучение |

### Remaining-time label

- No schedule, or `isNewSchedule(schedule)` true → **«Новое»** (will surface once the daily new-card slot opens; no due date exists yet).
- Schedule due in the future → **«через {formatInterval(due - now)}»**, reusing `formatInterval` from `srs.js` (already used for review-rating previews).
- Schedule due now or in the past (`isDueSchedule`) → **«Пора повторить»**.

## Rendering

Reuse the existing table convention from Словарь ([app.js:359-364](../../../app.js#L359-L364), `.table-wrap` / `.vocab-table` styles). New render function `renderUnlockedWordsList(rows)` produces one `<table>` per group with a group heading, columns:

| Французский | Перевод | Статус | Осталось до показа |

No new CSS component classes should be needed beyond what `.table-wrap`/`.vocab-table`/`.section-heading` already provide; a lesson-group heading can reuse `.section-heading`/`eyebrow` styling.

## Refresh behavior

No new polling. `scheduleReviewRefresh` ([app.js:1640-1655](../../../app.js#L1640-L1655)) is already called at the end of `renderReview()` and already re-renders the view at the moment the next card becomes due. Since `renderReview()` re-runs in "words" mode too, the list's remaining-time labels stay correct without additional timers. (The existing early return for `reviewMode === "cram"` does not apply to `"words"`, so the timer keeps scheduling as normal.)

## Edge cases

- **No active cards at all**: show the existing-style empty state (e.g. "Пока нет разблокированных слов.") instead of an empty table.
- **A lesson group with zero remaining cards after filtering** (shouldn't happen since grouping is derived directly from `getActiveCards()`, not filtered further) — not applicable.
- **Custom word with no lesson**: always goes to the trailing "Свои слова" group, per the grouping rule above — no lesson lookup needed.

## Testing

Add unit tests for `buildUnlockedWordRows` (grouping order, alphabetical sort within group, status label mapping for all four FSRS states, remaining-time label for new/future-due/overdue schedules) alongside the existing `srs.js` coverage in [tests/technical.mjs](../../../tests/technical.mjs) or a dedicated test file, following the existing test file's conventions for this repo.

## Out of scope

- No changes to the card-review/cram flow itself.
- No search/filter box on the word list (not requested).
- No live per-second countdown ticking — interval labels are minute-granularity, consistent with `formatInterval`.
