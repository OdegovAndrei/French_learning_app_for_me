# Unlocked Words Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third "Все слова" mode to the Повторение (review) screen that lists every unlocked (active) word/phrase card grouped by lesson, with its FSRS status and remaining time until it's next due.

**Architecture:** A new pure helper `buildUnlockedWordRows` in `srs.js` turns `(cards, schedules, now)` into an ordered, grouped, labeled list of row view-models (no DOM, unit-testable). `app.js` adds a third segmented-control button that switches `state.reviewMode` to `"words"`, and a new render function `renderUnlockedWordsList` turns those rows into grouped HTML tables reusing the existing `.table-wrap`/`.vocab-table` styles from the Словарь screen.

**Tech Stack:** Vanilla JS (ES modules), no build step, no framework. Tests run with `node`'s built-in `assert` via `node tests/smoke.mjs`. Frontend verified manually via the local dev server (`python3 server.py`, already configured as `.claude/launch.json` → `french-study` on port 5174).

## Global Constraints

- The word list always shows **all active cards** (`getActiveCards()`), ignoring the `state.reviewDeck` filter — confirmed in the design spec.
- No new polling/timer — reuse the existing `scheduleReviewRefresh` mechanism.
- Reuse existing CSS building blocks (`.table-wrap`, `.vocab-table`, `.section-heading`, `.eyebrow`) — the only CSS change is widening `.segmented` from 2 to 3 grid columns.
- Status labels (exact Russian strings): `Новое` (New), `Изучение` (Learning), `Повторение` (Review), `Переизучение` (Relearning).
- Remaining-time labels (exact format): `Новое` for cards with no schedule / still-new schedule; `через {formatInterval(...)}` for cards due in the future; `Пора повторить` for due/overdue cards.
- Grouping: by `card.lessonId`/`card.lessonTitle`, in the order lessons first appear in the input `cards` array, alphabetical (`localeCompare(..., "fr")`) by `front` within each group; the `"custom"` group (`lessonTitle` "Свои слова") always sorts last regardless of where it first appears.

---

## Task 1: `buildUnlockedWordRows` pure helper in srs.js

**Files:**
- Modify: `srs.js` (add new exported function near the other schedule-query helpers, e.g. after `isLearningSchedule`)
- Test: `tests/smoke.mjs` (add import + assertions; this file already covers `srs.js`)

**Interfaces:**
- Consumes: nothing new — uses existing `srs.js` internals (`State` from `./vendor/ts-fsrs/index.mjs`, already imported at the top of `srs.js`; `isNewSchedule`, `isDueSchedule`, `formatInterval`, all already defined in `srs.js`).
- Produces: `export function buildUnlockedWordRows({ cards, schedules, now = new Date() })` → returns `Array<{ id: string, front: string, back: string, groupLabel: string, statusLabel: string, remainingLabel: string }>`. `cards` is an array of card objects as produced by `buildCards`/`cardsFromVocabularyNote` in `cards.js` (must have `id`, `front`, `back`, `lessonId`, `lessonTitle`). `schedules` is a `Map<cardId, schedule>` as stored in `state.schedules`. Later tasks (Task 2, in `app.js`) call this with `{ cards: getActiveCards(), schedules: state.schedules, now: new Date() }`.

- [ ] **Step 1: Write the failing test**

Open `tests/smoke.mjs`. Add `buildUnlockedWordRows` to the existing `srs.js` import block near the top of the file:

```js
import {
  buildReviewQueue,
  buildUnlockedWordRows,
  createSchedule,
  createScheduler,
  previewSchedule,
  reviewSchedule
} from "../srs.js";
```

Then, immediately before the final `console.log(\`Smoke tests passed: ...\`)` line near the end of the file, add:

```js
const wordRowNow = new Date("2026-07-08T10:00:00.000Z");
const wordRowCards = [
  { id: "c:a", noteId: "n:a", source: "builtIn", front: "le pain", back: "хлеб", lessonId: "l01", lessonTitle: "Урок 1" },
  { id: "c:b", noteId: "n:b", source: "builtIn", front: "bonjour", back: "здравствуйте", lessonId: "l01", lessonTitle: "Урок 1" },
  { id: "c:c", noteId: "n:c", source: "builtIn", front: "merci", back: "спасибо", lessonId: "l02", lessonTitle: "Урок 2" },
  { id: "c:d", noteId: "n:d", source: "custom", front: "ananas", back: "ананас", lessonId: "custom", lessonTitle: "Свои слова" }
];
const wordRowSchedules = new Map([
  ["c:b", { ...createSchedule("c:b", wordRowNow), state: 2, reps: 3, due: new Date(wordRowNow.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString() }],
  ["c:c", { ...createSchedule("c:c", wordRowNow), state: 2, reps: 3, due: new Date(wordRowNow.getTime() - 60 * 60 * 1000).toISOString() }],
  ["c:d", { ...createSchedule("c:d", wordRowNow), state: 1, reps: 1, due: new Date(wordRowNow.getTime() + 5 * 60 * 1000).toISOString() }]
]);
// c:a has no schedule entry at all, i.e. a never-reviewed New card.

const wordRows = buildUnlockedWordRows({ cards: wordRowCards, schedules: wordRowSchedules, now: wordRowNow });
assert.equal(wordRows.length, 4, "Every active card produces exactly one row");
assert.deepEqual(
  wordRows.map((row) => row.front),
  ["bonjour", "le pain", "merci", "ananas"],
  "Rows are grouped by lesson in course order, alphabetical within each group, with the custom group last"
);
assert.deepEqual(
  wordRows.map((row) => row.groupLabel),
  ["Урок 1", "Урок 1", "Урок 2", "Свои слова"]
);
const lePain = wordRows.find((row) => row.front === "le pain");
assert.equal(lePain.statusLabel, "Новое", "A card with no schedule is New");
assert.equal(lePain.remainingLabel, "Новое", "A New card has no due countdown yet");
const bonjour = wordRows.find((row) => row.front === "bonjour");
assert.equal(bonjour.statusLabel, "Повторение");
assert.equal(bonjour.remainingLabel, "через 2 дн", "A card due in 2 days shows a future countdown");
const merci = wordRows.find((row) => row.front === "merci");
assert.equal(merci.statusLabel, "Повторение");
assert.equal(merci.remainingLabel, "Пора повторить", "An overdue card shows the due-now label");
const ananas = wordRows.find((row) => row.front === "ananas");
assert.equal(ananas.statusLabel, "Изучение");
assert.equal(ananas.remainingLabel, "через 5 мин");
assert.deepEqual(
  buildUnlockedWordRows({ cards: [], schedules: new Map(), now: wordRowNow }),
  [],
  "No active cards means no rows"
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/smoke.mjs`
Expected: it fails fast at module load with something like:
```
SyntaxError: The requested module '../srs.js' does not provide an export named 'buildUnlockedWordRows'
```

- [ ] **Step 3: Implement `buildUnlockedWordRows` in srs.js**

Open `srs.js`. Add this after `isLearningSchedule` (which ends around line 71) and before `countNewIntroducedToday`:

```js
const SCHEDULE_STATE_LABELS = {
  [State.New]: "Новое",
  [State.Learning]: "Изучение",
  [State.Review]: "Повторение",
  [State.Relearning]: "Переизучение"
};

export function buildUnlockedWordRows({ cards, schedules, now = new Date() }) {
  const groupOrder = [];
  const groups = new Map();
  for (const card of cards) {
    const key = card.lessonId || "custom";
    if (!groups.has(key)) {
      groups.set(key, { label: card.lessonTitle || "Свои слова", cards: [] });
      groupOrder.push(key);
    }
    groups.get(key).cards.push(card);
  }
  const orderedKeys = [
    ...groupOrder.filter((key) => key !== "custom"),
    ...groupOrder.filter((key) => key === "custom")
  ];

  return orderedKeys.flatMap((key) => {
    const group = groups.get(key);
    const sortedCards = [...group.cards].sort((a, b) => a.front.localeCompare(b.front, "fr"));
    return sortedCards.map((card) => {
      const schedule = schedules.get(card.id);
      return {
        id: card.id,
        front: card.front,
        back: card.back,
        groupLabel: group.label,
        statusLabel: SCHEDULE_STATE_LABELS[schedule?.state] || SCHEDULE_STATE_LABELS[State.New],
        remainingLabel: unlockedWordRemainingLabel(schedule, now)
      };
    });
  });
}

function unlockedWordRemainingLabel(schedule, now) {
  if (isNewSchedule(schedule)) return "Новое";
  if (isDueSchedule(schedule, now)) return "Пора повторить";
  return `через ${formatInterval(new Date(schedule.due).getTime() - now.getTime())}`;
}
```

This relies on `State` (already imported at the top of `srs.js` from `./vendor/ts-fsrs/index.mjs`) and on `isNewSchedule`, `isDueSchedule`, `formatInterval`, all already defined earlier in the same file.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/smoke.mjs`
Expected: prints `Smoke tests passed: 38 lessons, 118 exercises, ...` (existing summary line) with exit code 0 and no assertion errors.

- [ ] **Step 5: Commit**

```bash
git add srs.js tests/smoke.mjs
git commit -m "feat: add buildUnlockedWordRows for the unlocked-words list"
```

---

## Task 2: "Все слова" tab wiring in app.js + styles.css

**Files:**
- Modify: `app.js:13-21` (srs.js import block), `app.js:382-433` (`renderReview`), `app.js:761-786` (`bindReviewToolbar`) — add new function `renderUnlockedWordsList` right after `renderReview`
- Modify: `styles.css:987-994` (`.segmented` grid column count)

**Interfaces:**
- Consumes: `buildUnlockedWordRows` from Task 1 (`srs.js`), exact signature `buildUnlockedWordRows({ cards, schedules, now })` → `Array<{ id, front, back, groupLabel, statusLabel, remainingLabel }>`. Also uses existing `app.js` helpers `getActiveCards()`, `escapeHtml(value)`, `state.schedules` (a `Map`).
- Produces: no new exports — this is the UI leaf of the feature. `state.reviewMode` gains a third valid value: `"words"`.

- [ ] **Step 1: Import `buildUnlockedWordRows` in app.js**

In `app.js`, change the `srs.js` import block (currently lines 13-21):

```js
import {
  buildReviewQueue,
  createSchedule,
  isDueSchedule,
  isNewSchedule,
  previewSchedule,
  resetSchedule,
  reviewSchedule
} from "./srs.js";
```

to:

```js
import {
  buildReviewQueue,
  buildUnlockedWordRows,
  createSchedule,
  isDueSchedule,
  isNewSchedule,
  previewSchedule,
  resetSchedule,
  reviewSchedule
} from "./srs.js";
```

- [ ] **Step 2: Add the "Все слова" segmented button and branch `renderReview` on words mode**

Replace the current `renderReview` function (currently `app.js:382-433`):

```js
function renderReview() {
  const allCards = getAllCards();
  const allActive = getActiveCards();
  const suspendedCards = allCards.filter((card) => state.appState.suspendedCardIds.includes(card.id));
  const deckCards = filterCards(allActive, state.reviewDeck);
  let queue = buildReviewQueue({
    cards: deckCards,
    schedules: state.schedules,
    logs: state.reviewLogs,
    newLimit: state.settings.newCardsPerDay,
    cram: state.reviewMode === "cram",
    seen: state.reviewSeen
  });
  const summary = getReviewSummary(deckCards);
  if (!queue.length && summary.due > 0 && state.reviewSeen.size > 0) {
    state.reviewSeen.clear();
    queue = buildReviewQueue({
      cards: deckCards,
      schedules: state.schedules,
      logs: state.reviewLogs,
      newLimit: state.settings.newCardsPerDay,
      cram: state.reviewMode === "cram",
      seen: state.reviewSeen
    });
  }
  const card = queue[0];

  app.innerHTML = `
    <section class="review-stage">
      <div class="review-toolbar">
        <div class="segmented" aria-label="Режим повторения">
          <button type="button" data-review-mode="review" class="${state.reviewMode === "review" ? "active" : ""}">Повторение</button>
          <button type="button" data-review-mode="cram" class="${state.reviewMode === "cram" ? "active" : ""}">Зубрёжка</button>
        </div>
        <select id="review-deck" class="select-control" aria-label="Колода">
          ${renderDeckOptions()}
        </select>
        <button class="secondary-button" type="button" id="review-add-word">Добавить слово</button>
      </div>
      <div class="review-counters">
        <span><strong>${summary.due}</strong> пора</span>
        <span><strong>${summary.newCount}</strong> новых</span>
        <span><strong>${queue.length}</strong> в этой сессии</span>
      </div>
      ${card ? renderReviewCard(card) : renderReviewEmpty(summary)}
      ${renderSuspendedCards(suspendedCards)}
    </section>`;

  bindReviewToolbar();
  if (card) bindReviewCard(card);
  scheduleReviewRefresh(deckCards);
}
```

with:

```js
function renderReview() {
  const allCards = getAllCards();
  const allActive = getActiveCards();
  const suspendedCards = allCards.filter((card) => state.appState.suspendedCardIds.includes(card.id));
  const deckCards = filterCards(allActive, state.reviewDeck);
  const isWordsMode = state.reviewMode === "words";
  let queue = isWordsMode ? [] : buildReviewQueue({
    cards: deckCards,
    schedules: state.schedules,
    logs: state.reviewLogs,
    newLimit: state.settings.newCardsPerDay,
    cram: state.reviewMode === "cram",
    seen: state.reviewSeen
  });
  const summary = getReviewSummary(deckCards);
  if (!isWordsMode && !queue.length && summary.due > 0 && state.reviewSeen.size > 0) {
    state.reviewSeen.clear();
    queue = buildReviewQueue({
      cards: deckCards,
      schedules: state.schedules,
      logs: state.reviewLogs,
      newLimit: state.settings.newCardsPerDay,
      cram: state.reviewMode === "cram",
      seen: state.reviewSeen
    });
  }
  const card = queue[0];

  app.innerHTML = `
    <section class="review-stage">
      <div class="review-toolbar">
        <div class="segmented" aria-label="Режим повторения">
          <button type="button" data-review-mode="review" class="${state.reviewMode === "review" ? "active" : ""}">Повторение</button>
          <button type="button" data-review-mode="cram" class="${state.reviewMode === "cram" ? "active" : ""}">Зубрёжка</button>
          <button type="button" data-review-mode="words" class="${isWordsMode ? "active" : ""}">Все слова</button>
        </div>
        ${isWordsMode ? "" : `
        <select id="review-deck" class="select-control" aria-label="Колода">
          ${renderDeckOptions()}
        </select>`}
        <button class="secondary-button" type="button" id="review-add-word">Добавить слово</button>
      </div>
      ${isWordsMode ? "" : `
      <div class="review-counters">
        <span><strong>${summary.due}</strong> пора</span>
        <span><strong>${summary.newCount}</strong> новых</span>
        <span><strong>${queue.length}</strong> в этой сессии</span>
      </div>`}
      ${isWordsMode ? renderUnlockedWordsList(allActive) : (card ? renderReviewCard(card) : renderReviewEmpty(summary))}
      ${renderSuspendedCards(suspendedCards)}
    </section>`;

  bindReviewToolbar();
  if (!isWordsMode && card) bindReviewCard(card);
  scheduleReviewRefresh(isWordsMode ? allActive : deckCards);
}
```

Note the last line: in words mode the refresh timer watches `allActive` (matching what's actually displayed) instead of the deck-filtered `deckCards`.

- [ ] **Step 3: Add `renderUnlockedWordsList`**

Immediately after the `renderReview` function (i.e. right before `function renderProgress()`), add:

```js
function renderUnlockedWordsList(cards) {
  const rows = buildUnlockedWordRows({ cards, schedules: state.schedules, now: new Date() });
  if (!rows.length) {
    return `<div class="empty-state"><strong>Пока нет разблокированных слов</strong><p>Пройди урок или добавь своё слово, чтобы они появились здесь.</p></div>`;
  }
  const groups = [];
  for (const row of rows) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.label === row.groupLabel) {
      lastGroup.rows.push(row);
    } else {
      groups.push({ label: row.groupLabel, rows: [row] });
    }
  }
  return `
    <div class="unlocked-words-groups">
      ${groups.map((group) => `
        <section class="section-band with-top-gap">
          <div class="section-heading"><div><p class="eyebrow">${group.rows.length} слов</p><h4>${escapeHtml(group.label)}</h4></div></div>
          <div class="table-wrap">
            <table class="vocab-table">
              <thead><tr><th>Французский</th><th>Перевод</th><th>Статус</th><th>Осталось до показа</th></tr></thead>
              <tbody>
                ${group.rows.map((row) => `
                  <tr>
                    <td><strong>${escapeHtml(row.front)}</strong></td>
                    <td>${escapeHtml(row.back)}</td>
                    <td>${escapeHtml(row.statusLabel)}</td>
                    <td>${escapeHtml(row.remainingLabel)}</td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>
        </section>`).join("")}
    </div>`;
}
```

- [ ] **Step 4: Guard the now-optional `#review-deck` select in `bindReviewToolbar`**

In `bindReviewToolbar` (currently `app.js:761-786`), the deck `<select>` is no longer rendered in words mode, so the existing unconditional lookup would throw. Change:

```js
  document.querySelector("#review-deck").addEventListener("change", (event) => {
```

to:

```js
  document.querySelector("#review-deck")?.addEventListener("change", (event) => {
```

(Everything else in `bindReviewToolbar` — the `[data-review-mode]` click handlers, `#review-add-word`, `[data-card-resume]` — already works unmodified: the mode-switch handler reads `button.dataset.reviewMode` generically, so it already handles the new `"words"` button with no code change.)

- [ ] **Step 5: Widen the segmented control to 3 columns**

In `styles.css`, change (currently lines 987-994):

```css
.segmented {
  display: inline-grid;
  grid-template-columns: repeat(2, 1fr);
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-strong);
}
```

to:

```css
.segmented {
  display: inline-grid;
  grid-template-columns: repeat(3, 1fr);
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-strong);
}
```

- [ ] **Step 6: Run the existing automated test suite (regression check)**

This feature has no other automated DOM tests in this repo (`app.js` is verified manually via the browser, per project convention). Run the full suite to make sure nothing else broke:

Run:
```bash
node tests/smoke.mjs
node tests/exercises.mjs
node tests/mastery.mjs
node tests/technical.mjs
node tests/card-manifest.mjs
node tests/tts-cache.mjs
```
Expected: all six scripts exit 0 with their respective "passed" summary lines and no assertion errors.

- [ ] **Step 7: Manually verify in the browser**

Start the dev server (already configured in `.claude/launch.json` as `french-study`, `python3 server.py 5174`) and open `http://localhost:5174`.

Check:
1. Open the "Повторение" section. Confirm the toolbar now shows three buttons: "Повторение", "Зубрёжка", "Все слова", laid out evenly (no CSS overflow/squish from the 3-column grid change).
2. Click "Все слова". Confirm:
   - The deck `<select>` and the "пора / новых / в этой сессии" counters disappear.
   - A list of grouped tables appears, one section per lesson (in course order) plus a trailing "Свои слова" section if any custom words exist, each with columns Французский / Перевод / Статус / Осталось до показа.
   - Words never reviewed show status "Новое" and remaining "Новое".
   - Words with a future due date show "через N ..." consistent with the FSRS schedule.
   - Any overdue/due word shows "Пора повторить".
   - The "Добавить слово" button and any "Приостановленные карточки" section still work as before.
3. Switch back to "Повторение" and "Зубрёжка". Confirm the card-review flow (show answer, rate Again/Hard/Good/Easy, skip, reset, suspend) still works exactly as before — this task must not regress the existing review flow.
4. Check the browser console for errors while switching between all three modes.

- [ ] **Step 8: Commit**

```bash
git add app.js styles.css
git commit -m "feat: add unlocked words tab to review view"
```
