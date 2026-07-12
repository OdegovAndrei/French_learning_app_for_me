import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ALL_STORE_NAMES,
  CACHE_STORE_NAMES,
  DB_VERSION,
  STORE_NAMES,
  normalizeCompletionModel,
  validateBackup
} from "../storage.js";
import {
  checkLessonPrerequisites,
  evaluateLessonReadiness,
  getIntroducedLessonIds
} from "../mastery.js";

assert.deepEqual(CACHE_STORE_NAMES, ["ttsAudio"], "ttsAudio is the only cache-only store");
assert.ok(!STORE_NAMES.includes("ttsAudio"), "ttsAudio must never be part of the backup contract");
assert.deepEqual(ALL_STORE_NAMES, [...STORE_NAMES, ...CACHE_STORE_NAMES], "ALL_STORE_NAMES = backup stores + cache stores");
assert.equal(DB_VERSION, 2, "DB_VERSION must be bumped so existing users get the new store");

function emptyBackup() {
  return {
    format: "french-study-backup",
    version: 1,
    stores: Object.fromEntries(STORE_NAMES.map((name) => [name, []]))
  };
}

const valid = emptyBackup();
valid.stores.kv.push(
  {
    key: "appState",
    value: {
      completedLessons: ["l01"],
      currentView: "today",
      currentLessonId: "l02",
      scrollPositions: { today: 120 },
      suspendedCardIds: [],
      suspendedNoteIds: []
    }
  },
  { key: "settings", value: { voiceURI: "", voiceRate: 0.82, newCardsPerDay: 10 } }
);
const validSchedule = {
  id: "card:1",
  due: "2026-07-09T10:00:00.000Z",
  stability: 2,
  difficulty: 5,
  elapsed_days: 1,
  scheduled_days: 2,
  learning_steps: 0,
  reps: 1,
  lapses: 0,
  state: 2,
  last_review: "2026-07-07T10:00:00.000Z"
};
valid.stores.schedules.push(validSchedule);
assert.equal(validateBackup(valid), true);

const legacyPartial = emptyBackup();
legacyPartial.stores.kv.push({ key: "appState", value: { completedLessons: [] } });
assert.equal(validateBackup(legacyPartial), true, "Older version-1 appState records remain importable");

const brokenAppState = emptyBackup();
brokenAppState.stores.kv.push({ key: "appState", value: "broken" });
assert.throws(() => validateBackup(brokenAppState), /appState должен быть объектом/);

const duplicateRecords = emptyBackup();
duplicateRecords.stores.exercises.push({ id: "same", answer: "a" }, { id: "same", answer: "b" });
assert.throws(() => validateBackup(duplicateRecords), /повторяющийся ключ/);

const invalidSchedule = emptyBackup();
invalidSchedule.stores.schedules.push({ id: "card:1", due: "not-a-date" });
assert.throws(() => validateBackup(invalidSchedule), /неверная дата due/);

for (const patch of [
  { state: 999 },
  { stability: -1 },
  { difficulty: 11 },
  { reps: -1 },
  { scheduled_days: 1.5 }
]) {
  const snapshot = emptyBackup();
  snapshot.stores.schedules.push({ ...validSchedule, ...patch });
  assert.throws(() => validateBackup(snapshot));
}
const newCardSnapshot = emptyBackup();
newCardSnapshot.stores.schedules.push({
  ...validSchedule,
  stability: 0,
  difficulty: 0,
  elapsed_days: 0,
  scheduled_days: 0,
  reps: 0,
  state: 0,
  last_review: null
});
assert.equal(validateBackup(newCardSnapshot), true, "A new ts-fsrs card legitimately uses zero difficulty");

const completionDefaults = { completedLessons: [], legacyCompletedLessons: [], completionModelVersion: 2 };
assert.deepEqual(
  normalizeCompletionModel({ completedLessons: ["l01", "l02"] }, completionDefaults),
  { completedLessons: ["l01", "l02"], legacyCompletedLessons: [], completionModelVersion: 2 }
);
assert.deepEqual(
  normalizeCompletionModel({ completedLessons: ["l03"], legacyCompletedLessons: ["l01"], completionModelVersion: 1 }, completionDefaults),
  { completedLessons: ["l01", "l03"], legacyCompletedLessons: [], completionModelVersion: 2 }
);

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const storageSource = await readFile(new URL("../storage.js", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
assert.match(appSource, /function switchView\(view\) \{\s+stopRecording\(\);/);
assert.match(appSource, /if \(state\.reviewMode === "cram"\) \{[\s\S]*?state\.reviewSeen\.add\(card\.id\);[\s\S]*?return;/);
assert.match(appSource, /data-card-resume/);
assert.match(appSource, /window\.addEventListener\("pagehide"[\s\S]*?flushPendingSaves\(\)/);
assert.match(appSource, /reviewDirection: "ru-fr"/, "state must default to ru-fr direction");
assert.match(
  appSource,
  /const deckCards = filterCardsByDirection\(filterCards\(allActive, state\.reviewDeck\), state\.reviewDirection\);/,
  "renderReview must filter deck cards by the selected direction"
);
assert.match(appSource, /data-review-direction="ru-fr"/, "review toolbar must render an RU→FR direction button");
assert.match(appSource, /data-review-direction="fr-ru"/, "review toolbar must render an FR→RU direction button");
assert.match(
  appSource,
  /document\.querySelectorAll\("\[data-review-direction\]"\)\.forEach\(\(button\) => \{[\s\S]*?state\.reviewDirection = button\.dataset\.reviewDirection;[\s\S]*?state\.reviewSeen\.clear\(\);[\s\S]*?renderReview\(\);/,
  "direction buttons must update state.reviewDirection, reset the seen set, and re-render"
);

const masteryLesson = {
  id: "lesson:mastery",
  prerequisites: ["lesson:first"],
  exercises: [
    { id: "closed", type: "translate" },
    { id: "open", type: "writing" }
  ]
};
const attempts = new Map([
  ["closed", { id: "closed", lessonId: masteryLesson.id, result: { status: "correct" } }],
  ["open", { id: "open", lessonId: masteryLesson.id, result: { status: "open", needsReview: true, coverageComplete: true }, selfReviewed: false }]
]);
assert.equal(checkLessonPrerequisites(masteryLesson, []).met, false);
assert.equal(evaluateLessonReadiness(masteryLesson, attempts).canComplete, false);
attempts.get("open").selfReviewed = true;
assert.equal(evaluateLessonReadiness(masteryLesson, attempts).canComplete, true);
assert.deepEqual(
  getIntroducedLessonIds({ completedLessons: ["lesson:first"], attempts, currentLessonId: "lesson:current" }).sort(),
  ["lesson:current", "lesson:first", "lesson:mastery"].sort()
);
assert.match(appSource, /getIntroducedLessonIds\(/);
assert.match(appSource, /phrases: renderPhrases/);
assert.match(appSource, /state\.reviewDeck = "phrases"/);
assert.match(appSource, /isPhrasesDeck \? renderUnlockedPhrasesList\(deckCards\) : renderUnlockedWordsList\(deckCards\)/);
assert.match(indexSource, /app\.js\?v=20260712-phrases-1/);
assert.match(appSource, /data-self-review/);
assert.match(appSource, /checkCatalogLessonPrerequisites\(state\.data, lesson, state\.appState\.completedLessons\)/);
assert.match(appSource, /if \(!\(await saveAppState\(\)\)\) \{[\s\S]*?completedLessons = previousCompletedLessons/);
assert.match(appSource, /levels\.get\(firstModule\?\.levelId \|\| first\.level\)/);
assert.match(appSource, /blob\.size > MAX_BACKUP_FILE_BYTES/);
assert.match(appSource, /Старый прогресс/);
assert.match(appSource, /state\.data\.resources\.map/);
assert.match(appSource, /objective\?\.canDo \|\| objective\?\.cefrCanDo/);
assert.match(appSource, /module\.level \|\| module\.levelId/);
assert.match(appSource, /function transcribeRecording\(key, target, output, button\)/);
assert.match(appSource, /fetch\("\/stt", \{/);
assert.doesNotMatch(appSource, /webkitSpeechRecognition/);
assert.match(appSource, /await initializeFileStorage\(\);[\s\S]*?migrateLegacyProgress/);
assert.match(appSource, /Сохранено в файл/);
assert.doesNotMatch(appSource, /renderOriginWarning/);
assert.match(storageSource, /FILE_STORAGE_ENDPOINT}\/transaction/);
assert.match(storageSource, /initializeOnly: true/);

console.log("Technical regression tests passed: file storage, backup, recording, cram, mastery gates, introduced cards, resources, save flush.");
