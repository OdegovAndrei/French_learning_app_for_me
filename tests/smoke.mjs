import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildAnkiTsv } from "../anki.js";
import { buildCards, buildVocabularyNotes } from "../cards.js";
import { checkExercise } from "../exercises.js";
import { collectCourseValidationErrors, validateCourseCatalog } from "../course-validator.js";
import {
  buildReviewQueue,
  createSchedule,
  createScheduler,
  previewSchedule,
  reviewSchedule
} from "../srs.js";
import { STORE_NAMES, validateBackup } from "../storage.js";

const raw = await readFile(new URL("../data/lessons.json", import.meta.url), "utf8");
const data = JSON.parse(raw);

assert.equal(validateCourseCatalog(data), true);
assert.match(data.meta.title, /Starter/);
assert.equal(data.levels.length, 1, "The current catalog must expose one honest Starter track");
assert.ok(data.modules.length >= 3, "Starter content must be grouped into scalable modules");
assert.ok(data.lessons.length > 0, "The course needs at least one lesson");
assert.ok(data.pronunciationTopics.length > 0, "The course needs pronunciation topics");
assert.ok(data.grammarTopics.length > 0, "The course needs grammar topics");

const exercises = data.lessons.flatMap((lesson) => lesson.exercises);
assert.ok(exercises.length >= data.lessons.length, "Every lesson needs assessable practice");
for (const exercise of exercises) {
  assert.ok(exercise.id, "Every exercise needs a stable id");
  assert.ok(Array.isArray(exercise.acceptedAnswers));
  assert.ok(exercise.modelAnswer);
  assert.ok(Array.isArray(exercise.hints) && exercise.hints.length > 0);
  assert.ok(Array.isArray(exercise.requiredTokens));
  assert.ok(Array.isArray(exercise.objectiveIds) && exercise.objectiveIds.length > 0);
  assert.ok(exercise.explanation);
}
for (const lesson of data.lessons) {
  assert.ok(lesson.moduleId, "Every lesson needs a module reference");
  assert.ok(Number.isInteger(lesson.order) && lesson.order > 0);
  assert.ok(Array.isArray(lesson.prerequisites));
  assert.ok(Array.isArray(lesson.objectives) && lesson.objectives.length > 0);
}

const notes = buildVocabularyNotes(data);
const cards = buildCards(data);
const vocabularyItems = data.lessons.flatMap((lesson) => lesson.vocabulary);
assert.equal(notes.length, vocabularyItems.length, "Every vocabulary item must become a note");
assert.equal(
  cards.filter((card) => ["ru-fr", "fr-ru"].includes(card.kind)).length,
  vocabularyItems.length * 2,
  "Every built-in vocabulary item must keep both review directions"
);
assert.equal(new Set(cards.map((card) => card.id)).size, cards.length, "Card ids must be unique");

const legacyVocabularyIds = [
  ...legacyIds("vocab:l01:", 3),
  ...legacyIds("vocab:l02:", 4),
  ...legacyIds("vocab:l03:", 3),
  ...legacyIds("vocab:l04:", 4),
  ...legacyIds("vocab:l05:", 4),
  ...legacyIds("vocab:l06:", 4),
  ...legacyIds("vocab:l07:", 4),
  ...legacyIds("vocab:l08:", 4)
];
const legacyPhraseCardIds = [
  "phrase:l02:0", "phrase:l02:1", "phrase:l02:2",
  "phrase:l03:0", "phrase:l03:1", "phrase:l03:2",
  "phrase:l04:0", "phrase:l04:2",
  "phrase:l05:0", "phrase:l05:2",
  "phrase:l06:0", "phrase:l06:1",
  "phrase:l07:0", "phrase:l07:2",
  "phrase:l08:0", "phrase:l08:1", "phrase:l08:2"
];
const cardIds = new Set(cards.map((card) => card.id));
for (const noteId of legacyVocabularyIds) {
  assert.ok(cardIds.has(`${noteId}:ru-fr`), `Legacy card id must survive: ${noteId}:ru-fr`);
  assert.ok(cardIds.has(`${noteId}:fr-ru`), `Legacy card id must survive: ${noteId}:fr-ru`);
}
for (const cardId of legacyPhraseCardIds) {
  assert.ok(cardIds.has(cardId), `Legacy card id must survive: ${cardId}`);
}

const reordered = structuredClone(data);
for (const lesson of reordered.lessons) {
  lesson.vocabulary.reverse();
  lesson.cards.reverse();
}
assert.deepEqual(
  cardIdentityMap(buildCards(reordered)),
  cardIdentityMap(cards),
  "Reordering catalog arrays must not silently reassign card ids"
);

const brokenReference = structuredClone(data);
brokenReference.lessons[0].grammarTopic = "missing-grammar-topic";
assert.ok(
  collectCourseValidationErrors(brokenReference).some((error) => error.includes("unknown id")),
  "Orphan grammar references must be rejected"
);

const brokenPronunciationReference = structuredClone(data);
brokenPronunciationReference.lessons[0].pronunciationTopic = "missing-pronunciation-topic";
assert.ok(
  collectCourseValidationErrors(brokenPronunciationReference).some((error) => error.includes("unknown id")),
  "Orphan pronunciation references must be rejected"
);

const brokenModuleReference = structuredClone(data);
brokenModuleReference.lessons[0].moduleId = "module:missing";
assert.ok(
  collectCourseValidationErrors(brokenModuleReference).some((error) => error.includes("moduleId: unknown id")),
  "Orphan lesson-to-module references must be rejected"
);

const brokenLevelReference = structuredClone(data);
brokenLevelReference.modules[0].levelId = "missing-level";
assert.ok(
  collectCourseValidationErrors(brokenLevelReference).some((error) => error.includes("levelId: unknown id")),
  "Orphan module-to-level references must be rejected"
);

const unknownModulePrerequisite = structuredClone(data);
unknownModulePrerequisite.modules[0].prerequisites = ["module:missing"];
assert.ok(
  collectCourseValidationErrors(unknownModulePrerequisite).some((error) => error.includes("unknown id")),
  "Unknown module prerequisites must be rejected"
);

const selfLessonPrerequisite = structuredClone(data);
selfLessonPrerequisite.lessons[0].prerequisites = [selfLessonPrerequisite.lessons[0].id];
assert.ok(
  collectCourseValidationErrors(selfLessonPrerequisite).some((error) => error.includes("self prerequisite")),
  "Self lesson prerequisites must be rejected"
);

const unknownLessonPrerequisite = structuredClone(data);
unknownLessonPrerequisite.lessons[0].prerequisites = ["lesson:missing"];
assert.ok(
  collectCourseValidationErrors(unknownLessonPrerequisite).some((error) => error.includes("unknown id")),
  "Unknown lesson prerequisites must be rejected"
);

const selfLevelPrerequisite = structuredClone(data);
selfLevelPrerequisite.levels[0].prerequisites = [selfLevelPrerequisite.levels[0].id];
assert.ok(
  collectCourseValidationErrors(selfLevelPrerequisite).some((error) => error.includes("self prerequisite")),
  "Self level prerequisites must be rejected"
);

const moduleCycle = structuredClone(data);
moduleCycle.modules[0].prerequisites = [moduleCycle.modules[1].id];
assert.ok(
  collectCourseValidationErrors(moduleCycle).some((error) => error.includes("modules: prerequisite cycle")),
  "Module prerequisite cycles must be rejected"
);

const lessonCycle = structuredClone(data);
lessonCycle.lessons[0].prerequisites = [lessonCycle.lessons[1].id];
assert.ok(
  collectCourseValidationErrors(lessonCycle).some((error) => error.includes("lessons: prerequisite cycle")),
  "Lesson prerequisite cycles must be rejected"
);

const unknownObjectiveReference = structuredClone(data);
unknownObjectiveReference.lessons[0].exercises[0].objectiveIds = ["obj:missing"];
assert.ok(
  collectCourseValidationErrors(unknownObjectiveReference).some((error) => error.includes("unknown id")),
  "Exercises must not reference unknown objectives"
);

const duplicateObjectiveId = structuredClone(data);
duplicateObjectiveId.lessons[0].objectives[1].id = duplicateObjectiveId.lessons[0].objectives[0].id;
assert.ok(
  collectCourseValidationErrors(duplicateObjectiveId).some((error) => error.includes("duplicate id")),
  "Objective ids must be globally unique"
);

const duplicateObjectiveReference = structuredClone(data);
const repeatedObjectiveId = duplicateObjectiveReference.lessons[0].exercises[0].objectiveIds[0];
duplicateObjectiveReference.lessons[0].exercises[0].objectiveIds.push(repeatedObjectiveId);
assert.ok(
  collectCourseValidationErrors(duplicateObjectiveReference).some((error) => error.includes("duplicate reference")),
  "Duplicate objective references must be rejected"
);

const uncoveredRequiredObjective = structuredClone(data);
for (const exercise of uncoveredRequiredObjective.lessons[0].exercises) {
  exercise.objectiveIds = ["obj:l01:use-social-formulas"];
}
assert.ok(
  collectCourseValidationErrors(uncoveredRequiredObjective).some((error) => error.includes("is not covered")),
  "Every required objective must be covered by an exercise"
);

const optionalOnlyObjectiveCoverage = structuredClone(data);
const optionalOnlyObjectiveId = optionalOnlyObjectiveCoverage.lessons[0].objectives[0].id;
for (const exercise of optionalOnlyObjectiveCoverage.lessons[0].exercises) {
  if (exercise.objectiveIds.includes(optionalOnlyObjectiveId)) exercise.required = false;
}
assert.ok(
  collectCourseValidationErrors(optionalOnlyObjectiveCoverage).some(
    (error) => error.includes(optionalOnlyObjectiveId) && error.includes("is not covered")
  ),
  "Optional exercises must not satisfy coverage of a required objective"
);

const duplicateId = structuredClone(data);
duplicateId.lessons[0].vocabulary[1].id = duplicateId.lessons[0].vocabulary[0].id;
assert.ok(
  collectCourseValidationErrors(duplicateId).some((error) => error.includes("duplicate id")),
  "Duplicate stable ids must be rejected"
);

const futureLevel = structuredClone(data);
futureLevel.levels.push({
  id: "future-b2",
  title: "Future B2 track",
  claim: "Schema compatibility fixture",
  order: 2,
  cefrLevels: ["B2"],
  prerequisites: ["starter"]
});
futureLevel.modules.push({
  id: "module:future-b2:fixture",
  levelId: "future-b2",
  title: "Future module fixture",
  description: "Schema compatibility fixture",
  order: 1,
  prerequisites: ["module:starter:help"]
});
futureLevel.lessons[0].level = "B2";
futureLevel.lessons[0].moduleId = "module:future-b2:fixture";
assert.equal(validateCourseCatalog(futureLevel), true, "B1/B2 content must be accepted without engine changes");

const unsupportedLevel = structuredClone(data);
unsupportedLevel.lessons[0].level = "C3";
assert.ok(
  collectCourseValidationErrors(unsupportedLevel).some((error) => error.includes("unsupported level")),
  "Unknown level labels must be rejected"
);

const unsupportedSchema = structuredClone(data);
unsupportedSchema.meta.catalogSchemaVersion += 1;
assert.ok(
  collectCourseValidationErrors(unsupportedSchema).some((error) => error.includes("catalogSchemaVersion")),
  "Unknown catalog schema versions must require an explicit migration"
);

const custom = {
  id: "custom:test",
  source: "custom",
  fr: "une pomme",
  ru: "яблоко",
  ipa: "/yn pɔm/",
  note: "",
  tags: ["food"],
  directions: ["ru-fr", "fr-ru"]
};
assert.equal(buildCards(data, [custom]).length, cards.length + 2, "A custom two-way note adds two cards");

const now = new Date("2026-07-08T10:00:00.000Z");
const firstSchedule = createSchedule(cards[0].id, now);
const preview = previewSchedule(firstSchedule, now, createScheduler({ enable_fuzz: false }));
assert.equal(preview.again.interval, "1 мин");
assert.equal(preview.good.interval, "10 мин");
const reviewed = reviewSchedule(firstSchedule, "good", now, createScheduler({ enable_fuzz: false }));
assert.equal(reviewed.log.wasNew, true);
assert.equal(reviewed.schedule.reps, 1);
assert.ok(new Date(reviewed.schedule.due) > now);

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

const overdue = {
  ...createSchedule(cards[20].id, now),
  due: "2026-07-07T10:00:00.000Z",
  state: 2,
  reps: 3,
  stability: 2,
  difficulty: 5,
  scheduled_days: 2,
  last_review: "2026-07-05T10:00:00.000Z"
};
const queueWithDue = buildReviewQueue({
  cards,
  schedules: new Map([[overdue.id, overdue]]),
  logs: [],
  now,
  newLimit: 10,
  cram: false,
  seen: new Set()
});
assert.equal(queueWithDue[0].id, overdue.id, "Due cards should be shown before new cards");

const translation = data.lessons[4].exercises[1];
const coverage = checkExercise(
  translation,
  "Est-ce que vous avez du fromage ?\nEst-ce que vous avez de l'eau ?\nEst-ce que vous avez un sac ?"
);
assert.equal(coverage.status, "open");
assert.equal(coverage.coverageComplete, true);

const cafeExercise = data.lessons[3].exercises[0];
const cafeCoverage = checkExercise(
  cafeExercise,
  "Je voudrais un cafe.\nJe voudrais de l'eau.\nJe voudrais un croissant.\nJe voudrais un the."
);
assert.equal(cafeCoverage.status, "almost", "Missing accents should be reported separately");

const exact = checkExercise(data.lessons[0].exercises[0], "Bonjour merci au revoir");
assert.equal(exact.status, "correct", "Case and punctuation should be ignored");

const accentExercise = {
  type: "translate",
  acceptedAnswers: ["Un café"],
  hints: ["Accent needed"]
};
assert.equal(checkExercise(accentExercise, "un cafe").status, "almost");

const tsv = buildAnkiTsv(cards);
assert.ok(tsv.startsWith("#separator:Tab"));
assert.ok(tsv.includes("#tags column:4"));
assert.equal((tsv.match(/FrenchStudy/g) || []).length, cards.length);

const validBackup = {
  format: "french-study-backup",
  version: 1,
  stores: Object.fromEntries(STORE_NAMES.map((name) => [name, []]))
};
assert.equal(validateBackup(validBackup), true);
assert.throws(() => validateBackup({ format: "wrong", version: 1, stores: {} }));

console.log(`Smoke tests passed: ${data.lessons.length} lessons, ${exercises.length} exercises, ${cards.length} cards.`);

function legacyIds(prefix, count) {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`);
}

function cardIdentityMap(cardList) {
  return Object.fromEntries(
    cardList
      .map((card) => [card.id, `${card.noteId}|${card.kind}|${card.front}|${card.back}`])
      .sort(([left], [right]) => left.localeCompare(right))
  );
}
