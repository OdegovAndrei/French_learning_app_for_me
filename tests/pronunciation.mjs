import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildPronunciationCards,
  collectPronunciationCourseErrors,
  filterPronunciationCards,
  introducedPronunciationCards,
  validatePronunciationCourse
} from "../pronunciation-course.js";
import { STORE_NAMES, validateBackup } from "../storage.js";

const data = JSON.parse(await readFile(new URL("../data/pronunciation-course.json", import.meta.url), "utf8"));
const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");

assert.equal(validatePronunciationCourse(data), true);
assert.deepEqual(collectPronunciationCourseErrors(data), []);
assert.equal(data.modules.length, 4, "The reading course progresses through four stages");
assert.equal(data.lessons.length, 8, "The focused reading plan contains eight lessons");
assert.match(data.meta.method, /сочетание → звук → слово → несколько слов/);
assert.match(data.meta.cardMethod, /одна атомарная карточка = одно написание в одном контексте/);
assert.equal(data.sources.length, 1, "The user guide is the only curricular source");

const cards = buildPronunciationCards(data);
const atomicCards = cards.filter((card) => card.id.startsWith("pron-atom:"));
const synthesisCards = cards.filter((card) => card.id.startsWith("pron-word:"));
assert.equal(cards.length, 127, "The eight lessons contribute 127 focused reading cards");
assert.equal(atomicCards.length, 120, "Every spelling or contextual mapping has its own card");
assert.equal(synthesisCards.length, 7, "Whole-word cards supplement but never replace atomic mappings");
assert.equal(new Set(cards.map((card) => card.id)).size, cards.length, "Reading card ids are stable and unique");
assert.ok(cards.every((card) => /^(pron-atom|pron-word):/.test(card.id)), "Reading schedules use new separate id namespaces");
assert.ok(cards.every((card) => !card.id.startsWith("pron-read:")), "Legacy grouped schedules cannot leak into atomic cards");
assert.ok(cards.every((card) => card.source === "pronunciation" && card.noteId === card.id));
assert.ok(cards.every((card) => card.audioText && card.prompt && card.answer && card.explanation));
assert.ok(atomicCards.every((card) => !/Как читаются|Какие звуки|Какие два/.test(card.prompt)), "Atomic prompts never quiz several spellings at once");

for (const id of [
  "pron-atom:01:i", "pron-atom:01:u", "pron-atom:01:u-circ", "pron-atom:01:ou",
  "pron-atom:02:et-word", "pron-atom:02:et-ending", "pron-atom:02:eu-closed", "pron-atom:02:eu-open",
  "pron-atom:04:c-e", "pron-atom:04:c-i", "pron-atom:04:c-y",
  "pron-atom:05:in", "pron-atom:05:ain", "pron-atom:05:ein", "pron-atom:05:aim",
  "pron-atom:08:s-liaison", "pron-atom:08:x-liaison"
]) {
  assert.ok(cards.some((card) => card.id === id), `Atomic card ${id} must exist`);
}

for (const kind of ["pattern", "word", "rule", "exception", "flow"]) {
  assert.ok(cards.some((card) => card.kind === kind), `The review tab must include ${kind} cards`);
  assert.ok(filterPronunciationCards(cards, { kind }).every((card) => card.kind === kind));
}

const expectedLessonCardCounts = [16, 28, 7, 16, 19, 15, 14, 12];
for (let index = 0; index < data.lessons.length; index += 1) {
  const lesson = data.lessons[index];
  assert.equal(lesson.order, index + 1);
  assert.equal(lesson.cards.length, expectedLessonCardCounts[index]);
  assert.ok(lesson.examples.length >= 4);
  assert.ok(lesson.spellings.length >= 4);
  assert.ok(!("articulation" in lesson));
  assert.ok(!("contrasts" in lesson));
  assert.ok(!("recordText" in lesson));
  if (index === 0) assert.deepEqual(lesson.prerequisites, []);
  else assert.deepEqual(lesson.prerequisites, [data.lessons[index - 1].id]);
}

const firstLessonCards = introducedPronunciationCards(data, ["read-01"]);
assert.equal(firstLessonCards.length, 16, "Completing the first lesson unlocks fourteen atoms and two word cards");
assert.ok(firstLessonCards.every((card) => card.lessonId === "read-01"));
assert.equal(filterPronunciationCards(cards, { deck: "short-patterns" }).length, 51);
assert.equal(filterPronunciationCards(cards, { deck: "read-08" }).length, 12);

assert.match(data.lessons[0].rule, /сочетание целиком/);
assert.match(data.lessons[3].rule, /следующую букву/);
assert.match(data.lessons[5].rule, /Носовой блок распадается/);
assert.match(data.lessons[6].rule, /проверь окончание/);
assert.match(data.lessons[7].rule, /h сама по себе не произносится/);

const spellingPatterns = data.lessons.flatMap((lesson) => lesson.spellings.map((item) => item.pattern)).join(" · ");
for (const pattern of ["aou", "e+mm", "e+nn", "est", "-et", "ey", "oo", "u+m", "aim", "yn", "ym", "ien", "aon", "aen", "un, um"]) {
  assert.ok(spellingPatterns.includes(pattern), `Reference spelling ${pattern} must be covered`);
}
assert.match(data.lessons[1].rule, /Обычные e и o зависят от позиции/);
assert.match(data.lessons[4].rule, /традиционный звук un\/um/);
assert.match(data.lessons[5].rule, /не образуют универсальных правил/);

assert.match(indexSource, /data-view="pronunciation">Правила чтения/);
assert.match(indexSource, /data-view="pronunciation-review">Повторение чтения/);
assert.match(indexSource, /app\.js\?v=20260714-reading-4/);
assert.match(appSource, /data\/pronunciation-course\.json\?v=20260714-reading-4/);
assert.match(appSource, /pronunciationData: null/);
assert.match(appSource, /pronunciationState: defaultPronunciationState\(\)/);
assert.match(appSource, /"pronunciation-review": renderPronunciationReview/);
assert.match(appSource, /setValue\("pronunciationState", state\.pronunciationState\)/);
assert.match(appSource, /pronunciationNewCardsPerDay: 12/);
assert.match(appSource, /Сочетание → звук/);
assert.match(appSource, /Проверить по аудио/);

const independentLessonRenderer = appSource.match(
  /function renderPronunciationLesson\(lesson\) \{[\s\S]*?\n\}\n\nfunction renderPronunciationReference/
)?.[0];
assert.ok(independentLessonRenderer);
assert.doesNotMatch(independentLessonRenderer, /renderVoiceLab|articulation|contrasts|Whisper/);

const backup = {
  format: "french-study-backup",
  version: 1,
  stores: Object.fromEntries(STORE_NAMES.map((name) => [name, []]))
};
backup.stores.kv.push(
  {
    key: "pronunciationState",
    value: { completedLessons: ["read-01"], currentLessonId: "read-02", suspendedCardIds: [] }
  },
  {
    key: "settings",
    value: { voiceURI: "fr-FR-DeniseNeural", voiceRate: 0.82, newCardsPerDay: 20, pronunciationNewCardsPerDay: 12 }
  }
);
assert.equal(validateBackup(backup), true, "Reading progress survives backup and restore");

const brokenBackup = structuredClone(backup);
brokenBackup.stores.kv[0].value.completedLessons = "read-01";
assert.throws(() => validateBackup(brokenBackup), /completedLessons должен быть массивом строк/);

console.log(`reading rules: ${data.lessons.length} lessons, ${cards.length} cards`);
