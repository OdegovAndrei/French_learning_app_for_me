import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ALL_STORE_NAMES,
  CACHE_STORE_NAMES,
  DB_VERSION,
  getLevelStorageId,
  getLevelStorageKey,
  STORE_NAMES,
  normalizeCompletionModel,
  validateBackup
} from "../storage.js";
import {
  checkLessonPrerequisites,
  evaluateLessonReadiness,
  getCompletedLessonIds
} from "../mastery.js";
import { createRecordingRuntime } from "../recording-runtime.js";

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
  { key: "settings", value: { learnerName: "Анна", voiceURI: "", voiceRate: 0.82, newCardsPerDay: 10 } }
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

assert.equal(getLevelStorageKey("a1", "appState"), "appState", "A1 keeps legacy state keys");
assert.equal(getLevelStorageKey("a2", "appState"), "a2:appState", "A2 state is namespaced");
assert.equal(getLevelStorageId("a1", "card:1"), "card:1", "A1 keeps legacy record ids");
assert.equal(getLevelStorageId("a2", "card:1"), "a2:card:1", "A2 record ids cannot collide with A1");
assert.equal(getLevelStorageKey("b1", "appState"), "b1:appState", "future levels use the same generic namespace");
assert.equal(getLevelStorageId("a2.2", "card:1"), "a2.2:card:1", "sublevels can use the generic namespace");
assert.throws(() => getLevelStorageKey("advanced", "appState"), /Неизвестный уровень/);

const levelBackup = emptyBackup();
levelBackup.stores.kv.push(
  { key: "selectedLevel", value: "a2" },
  { key: "a2:appState", value: { currentView: "today" } }
);
levelBackup.stores.schedules.push({ ...validSchedule, id: "a2:card:1" });
assert.equal(validateBackup(levelBackup), true, "A2 records remain valid in the shared backup");

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

const shellSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const appSource = await readFile(new URL("../levels/a1/app.js", import.meta.url), "utf8");
const a2Source = await readFile(new URL("../levels/a2/app.js", import.meta.url), "utf8");
const runtimeSource = await readFile(new URL("../course-runtime.js", import.meta.url), "utf8");
const recordingRuntimeSource = await readFile(new URL("../recording-runtime.js", import.meta.url), "utf8");
const exercisesSource = await readFile(new URL("../exercises.js", import.meta.url), "utf8");
const storageSource = await readFile(new URL("../storage.js", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("../styles.css", import.meta.url), "utf8");
assert.match(appSource, /createCourseRuntime\(\{[\s\S]*?beforeSwitch:[\s\S]*?stopRecording\(\)/, "A1 delegates navigation lifecycle to the shared runtime");
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
assert.match(indexSource, /data-view="listening"/, "navigation must expose the regular listening ladder");
assert.match(appSource, /listening: renderListeningLadder/, "the app must render the listening ladder view");
assert.match(appSource, /function checkListeningLadderDictation\(drill, answer\)/, "listening dictation needs a dedicated exact-text check");
assert.match(appSource, /Транскрипт откроется только после попытки/, "the ladder must keep the transcript hidden until dictation is checked");
assert.match(appSource, /setValue\("listeningLadder", state\.listeningLadder\)/, "listening ladder progress must be saved locally");
assert.match(appSource, /id="review-shuffle"/, "review toolbar must render the shuffle button");
assert.match(appSource, /shuffleReviewQueueByPool\(queue, schedules\)/, "shuffle must keep new and review cards in separate pools");
assert.match(appSource, /state\.reviewQueueOrder = createShuffledQueueOrder\(queue, state\.schedules\);/, "shuffle must preserve its order through card re-renders");
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
assert.deepEqual(getCompletedLessonIds(["lesson:first", "lesson:first"]), ["lesson:first"]);
const activeCardsSource = appSource.slice(
  appSource.indexOf("function getActiveCards()"),
  appSource.indexOf("function getReviewSummary(")
);
assert.match(activeCardsSource, /getCompletedLessonIds\(state\.appState\.completedLessons\)/);
assert.doesNotMatch(activeCardsSource, /currentLessonId|exerciseAttempts|legacyCompletedLessons/);
assert.doesNotMatch(appSource, /getIntroducedLessonIds/);
assert.match(appSource, /phrases: renderPhrases/);
assert.match(appSource, /state\.reviewDeck = "phrases"/);
assert.match(appSource, /isPhrasesDeck \? renderUnlockedPhrasesList\(deckCards\) : renderUnlockedWordsList\(deckCards\)/);
assert.match(indexSource, /app\.js\?v=20260722-a2-block-6/);
assert.match(appSource, /data-self-review/);
assert.match(appSource, /from "\.\.\/\.\.\/exercise-help\.js"/);
assert.match(appSource, /function renderExerciseHelp\(hints, hintLevel, availableHintCount\)/);
assert.match(appSource, /attempt\.helpFailures = getNonNegativeInteger\(attempt\.helpFailures\) \+ 1/);
assert.match(appSource, /Следующий шаг откроется после ещё одной попытки/);
assert.doesNotMatch(appSource, /exercise\.hints\?\.join\(" "\)/, "help steps must not be concatenated");
assert.doesNotMatch(exercisesSource, /exercise\.hints\?\.\[0\]/, "wrong-answer feedback must not repeat the first hint");
assert.match(appSource, /checkCatalogLessonPrerequisites\(state\.data, lesson, state\.appState\.completedLessons\)/);
assert.match(appSource, /if \(!\(await saveAppState\(\)\)\) \{[\s\S]*?completedLessons = previousCompletedLessons/);
assert.match(appSource, /levels\.get\(firstModule\?\.levelId \|\| first\.level\)/);
assert.match(appSource, /blob\.size > MAX_BACKUP_FILE_BYTES/);
assert.match(appSource, /Итоговые задания/);
assert.doesNotMatch(appSource, /Старый прогресс/, "migrated lessons must not be presented as a second progress model");
assert.match(appSource, /state\.data\.resources\.map/);
assert.match(appSource, /objective\?\.canDo \|\| objective\?\.cefrCanDo/);
assert.match(appSource, /module\.level \|\| module\.levelId/);
assert.match(appSource, /function transcribeRecording\(key, target, targetAvailable, output, button\)/);
assert.match(appSource, /fetch\("\/stt", \{/);
assert.doesNotMatch(appSource, /webkitSpeechRecognition/);
assert.match(appSource, /await initializeFileStorage\(\);[\s\S]*?migrateLegacyProgress/);
assert.match(appSource, /Сохранено в файл/);
assert.doesNotMatch(appSource, /renderOriginWarning/);
assert.match(storageSource, /FILE_STORAGE_ENDPOINT}\/transaction/);
assert.match(storageSource, /initializeOnly: true/);
assert.match(shellSource, /const LEVELS = Object\.freeze\(/, "the shell must own the level registry");
assert.match(shellSource, /getValue\("selectedLevel", "a1"\)/, "the selected level must persist globally");
assert.match(shellSource, /document\.documentElement\.dataset\.level = activeLevel\.id/, "the shell must apply the level palette");
assert.match(shellSource, /function renderLearnerName\(value\)/, "the shell must show the learner name instead of the level label");
assert.match(shellSource, /function setLevelMenuOpen\(open\)/, "the shell must control the level menu state");
assert.match(shellSource, /await activeExperience\?\.dispose\?\.\(\);/, "switching levels must dispose the active experience");
assert.match(runtimeSource, /export function createCourseRuntime/, "A1 and A2 must share the level lifecycle runtime");
assert.match(runtimeSource, /nav\?\.addEventListener\("click", handleNavigationClick\)/, "the runtime owns delegated level navigation");
assert.match(indexSource, /id="level-switch"[^>]*aria-controls="level-menu"/, "the green level mark controls the level menu");
assert.match(indexSource, /class="brand-mark"[^>]*>A1<\//, "the mark displays A1 by default");
assert.match(indexSource, /<html lang="ru" data-level="a1">/, "A1 palette must be the initial page palette");
assert.match(stylesSource, /:root\[data-level="a2"\] \{[\s\S]*?--accent: #2d5b9a;[\s\S]*?--accent-dark: #234879;[\s\S]*?--accent-soft: #e5eefb;/, "A2 must have an independent blue palette");
assert.match(a2Source, /createLevelStorage\("a2"\)/, "A2 must use its own scoped storage");
assert.match(appSource, /id="learner-name"/, "A1 settings must provide a learner name field");
assert.match(a2Source, /id="learner-name"/, "A2 settings must provide the shared learner name field");
assert.match(appSource, /export const levelExperience/, "A1 exposes a lifecycle contract to the shell");
assert.match(a2Source, /export const levelExperience/, "A2 exposes a lifecycle contract to the shell");
assert.match(a2Source, /today: "Сегодня",[\s\S]*?settings: "Настройки"/, "A2 keeps the five-view shell contract");
assert.match(a2Source, /data\/a2\/course\.json/, "A2 loads its independent course catalog");
assert.match(a2Source, /data\/a2\/can-do\.json/, "A2 loads its A2.1\/A2.2 matrix");
assert.match(a2Source, /const modules = \[\.\.\.state\.data\.modules\]\.sort/, "A2 lesson view must render every published module from the catalog");
assert.match(a2Source, /modules\.map\(\(module\) =>/, "A2 lesson groups must not be hard-coded to one block");
assert.match(a2Source, /const publishedBlocks = blocks\.filter/, "A2 progress must count published blocks from the matrix");
assert.match(a2Source, /function getModulePhaseLabel\(module\)/, "A2 modules must derive their A2.1 or A2.2 phase from the matrix");
assert.match(a2Source, /buildCumulativeReviewQueue/, "A2 combines due A1\/A2 cards while introducing current-level cards");
assert.match(a2Source, /newCards: a2Cards/, "new review cards must come only from A2");
assert.match(a2Source, /createRecordingRuntime/, "A2 includes local oral recording");
assert.match(recordingRuntimeSource, /fetch\("\/stt", \{/, "the shared recording runtime keeps local STT");
const recordingRuntime = createRecordingRuntime({ storage: {}, speak: () => {}, getExerciseAttempt: () => ({}) });
const hiddenTargetLab = recordingRuntime.renderVoiceLab("Réponse modèle", "exercise:test", { showTarget: false, targetAvailable: false });
assert.doesNotMatch(hiddenTargetLab, />Réponse modèle</, "an oral model answer stays hidden before the learner reveals it");
assert.doesNotMatch(hiddenTargetLab, /data-speak/, "the hidden oral model cannot be played before it is revealed");
const visibleTargetLab = recordingRuntime.renderVoiceLab("Réponse modèle", "lesson:test");
assert.match(visibleTargetLab, />Réponse modèle</, "standalone pronunciation targets stay visible by default");
assert.match(a2Source, /showTarget: false,[\s\S]*?targetAvailable: attempt\.showModel === true/, "A2 oral exercises reveal playback with the model answer without duplicating its text");
assert.match(a2Source, /scheduleSettingsSave\(\{ learnerName: name \}\)/, "A2 saves profile edits while the learner types");
assert.match(a2Source, /scheduleSettingsSave\(\{ newCardsPerDay: value \}\)/, "A2 saves a valid review limit while the learner types");
assert.match(a2Source, /обычный урок в едином учебном прогрессе/, "A2 progress follows the responsible-learner premise");
assert.doesNotMatch(appSource, /if \(!prerequisites\.met \|\| !readiness\.canComplete\)/, "A1 completion must trust the learner instead of gating the lesson");
assert.doesNotMatch(a2Source, /if \(!getLessonPrerequisites\(lesson\)\.met \|\| !readiness\.canComplete\)/, "A2 completion must trust the learner instead of gating the lesson");
assert.match(appSource, /const disabled = isDone;/, "A1 completion is disabled only after the lesson is marked done");
assert.match(a2Source, /button\.disabled = done;/, "A2 completion is disabled only after the lesson is marked done");
assert.doesNotMatch(appSource, /data-pronunciation-lesson="\$\{escapeHtml\(lesson\.id\)\}" \$\{prerequisites\.met \? "" : "disabled"\}/, "reading lessons remain open in any order");
assert.match(appSource, /Checkpoint l38 — обычный итоговый урок курса/, "A1 checkpoint stays part of one learning progress model");
assert.match(appSource, /showTarget: false,[\s\S]*?targetAvailable: modelVisible === true/, "A1 oral exercises keep their model and playback hidden until the example is shown");
assert.match(storageSource, /return levelId === LEGACY_A1_LEVEL \? key : `\$\{levelId\}:\$\{key\}`;/, "storage namespacing must not hard-code A2");

console.log("Technical regression tests passed: file storage, shared runtime, cumulative review, recording, mastery, resources, save flush.");
