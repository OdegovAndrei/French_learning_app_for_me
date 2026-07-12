# Design: split RU→FR / FR→RU in the Повторение screen

## Problem

Cards in this app come in translation pairs: most vocabulary and phrase notes generate both a `ru-fr` card (Russian prompt → French answer) and an `fr-ru` card (French prompt → Russian answer). Today the Повторение (review) screen mixes both directions together in the same queue and in the same "Все слова"/"Все фразы" browsing list, for every deck (Все карточки/Слова/Фразы/Свои/по уроку). The user wants to practice one direction at a time instead of getting them interleaved.

## Scope

Applies only to the Повторение screen (`renderReview()` in [app.js](../../../app.js)) — this covers both plain vocabulary review and phrase review, since the standalone "Фразы" nav screen's "Повторять фразы" button already just opens Повторение with `state.reviewDeck = "phrases"`. The standalone Фразы browsing list itself (`renderPhrases()`) is unchanged — it keeps listing both directions' schedule info per row, as today.

No mixed/"both directions" option remains — direction becomes a mandatory third axis alongside review mode (Повторение/Зубрёжка/Все слова) and deck (Все карточки/Слова/Фразы/Свои/урок).

## State

Add `state.reviewDirection = "ru-fr"` next to the existing `reviewMode`/`reviewDeck` fields in `app.js`. In-memory only, not persisted — same lifetime as `reviewMode`/`reviewDeck` (resets on reload, defaults to `"ru-fr"`).

## UI placement

Add a new segmented control to the review toolbar in `renderReview()`, alongside the existing "Режим повторения" segmented control and the deck `<select>`:

```
[ RU → FR ]  [ FR → RU ]
```

- Visible in all three review modes (Повторение / Зубрёжка / Все слова), unlike the deck `<select>` which is already hidden in "Все слова" mode — direction still needs to filter the browsing list in that mode, so it must stay visible and interactive there.
- Selecting a direction behaves like the existing deck-change handler in `bindReviewToolbar`: sets `state.reviewDirection`, clears `state.reviewSeen`, resets `state.reviewAnswerVisible`, re-renders.

## Filtering logic (`cards.js`)

Cards encode direction inconsistently today:
- Vocabulary cards (from `cardsFromVocabularyNote`) have no `.direction` field; their direction is their `.kind` (`"ru-fr"` or `"fr-ru"`).
- Phrase cards (`kind: "phrase"`) have an explicit `.direction` field (`"ru-fr"` or `"fr-ru"`).
- Cloze cards (`kind: "cloze"`) have `.direction: null` — they're fill-in-the-blank French sentences with no translation direction.

Add a small helper to resolve this uniformly, plus a filter function, exported from `cards.js` alongside `filterCards`:

```js
function cardDirection(card) {
  if (card.kind === "ru-fr" || card.kind === "fr-ru") return card.kind;
  return card.direction || null;
}

export function filterCardsByDirection(cards, direction) {
  return cards.filter((card) => {
    const cardDir = cardDirection(card);
    if (cardDir === null) return direction === "ru-fr";
    return cardDir === direction;
  });
}
```

Cloze cards have no direction of their own, so per explicit decision they only appear in `ru-fr` mode (treated as part of the "reading French → producing/recalling" bucket); they're excluded entirely from `fr-ru` mode.

## Wiring into `renderReview`

Apply the new filter immediately after the existing deck filter:

```js
const deckCards = filterCardsByDirection(filterCards(allActive, state.reviewDeck), state.reviewDirection);
```

Everything downstream — `buildReviewQueue`, `getReviewSummary`, `renderUnlockedWordsList`/`renderUnlockedPhrasesList` (in "Все слова"/"Все фразы" mode), `scheduleReviewRefresh` — already takes `deckCards` as input and needs no further changes; it now just operates on the direction-filtered set. This composes with every existing deck value unchanged (Все карточки/Слова/Фразы/Свои/lesson id).

No changes to FSRS scheduling, ratings, cram logic, suspend/reset/edit-card actions, or the deck dropdown itself.

## Edge cases

- **A deck/direction combination with zero cards** (e.g. a brand-new lesson with only cloze cards, direction=fr-ru selected): falls through to the existing empty-state rendering (`renderReviewEmpty` / the empty-state branch in `renderUnlockedWordsList`/`renderUnlockedPhrasesList`) — no new empty-state copy needed, existing messages remain accurate.
- **Phrase notes with only one direction generated** (i.e. `back` wasn't a full French phrase, so no `fr-ru` reverse card was created — see `cardsFromVocabularyNote`/`buildCards` in `cards.js`): such a card simply doesn't appear when `fr-ru` is selected, which is correct — there's nothing to reverse.
- **Switching direction while mid-session in Повторение/Зубрёжка**: matches existing deck-switch behavior — queue position resets (`reviewSeen` cleared, answer hidden), no attempt to preserve queue position across the switch.

## Testing

Add unit tests for `filterCardsByDirection` (alongside existing `cards.js`/`filterCards` coverage): vocabulary cards route by `kind`, phrase cards route by `.direction`, cloze cards appear only under `ru-fr`, and phrase notes with a single generated direction don't appear under the other direction.

## Out of scope

- No changes to the standalone Фразы browsing screen (`renderPhrases()`) — it keeps showing both directions per row.
- No persistence of `state.reviewDirection` across reloads (matches `reviewMode`/`reviewDeck`).
- No changes to card content, FSRS scheduling, or the Словарь screen.
