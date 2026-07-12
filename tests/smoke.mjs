import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildAnkiTsv } from "../anki.js";
import { buildCards, buildVocabularyNotes } from "../cards.js";
import { checkExercise } from "../exercises.js";
import { collectCourseValidationErrors, validateCourseCatalog } from "../course-validator.js";
import {
  buildReviewQueue,
  buildUnlockedWordRows,
  createSchedule,
  createScheduler,
  previewSchedule,
  reviewSchedule
} from "../srs.js";
import { STORE_NAMES, validateBackup } from "../storage.js";

const raw = await readFile(new URL("../data/lessons.json", import.meta.url), "utf8");
const data = JSON.parse(raw);

assert.equal(validateCourseCatalog(data), true);
assert.match(data.meta.title, /A1/);
assert.equal(data.levels.length, 2, "The catalog must expose exactly the Starter and a1 tracks once A1 content ships");
assert.ok(data.modules.length >= 3, "Starter content must be grouped into scalable modules");
assert.equal(data.lessons.length, 41, "The catalog grows to 41 lessons once l08c (numbers 100+) ships");
assert.ok(data.pronunciationTopics.length > 0, "The course needs pronunciation topics");
assert.ok(data.grammarTopics.length > 0, "The course needs grammar topics");
assert.ok(data.courseRoadmap, "The catalog needs an explicit roadmap before scaling beyond Starter");
assert.equal(data.courseRoadmap.status, "draft");
assert.match(
  data.courseRoadmap.claimPolicy,
  /A1 заявлен как практический самостоятельный курс/,
  "The roadmap must keep level claims honest"
);
assert.ok(data.courseRoadmap.sources.length >= 3, "Roadmap needs official/public source links");
assert.ok(
  data.courseRoadmap.sources.some((source) => source.url.includes("coe.int")),
  "Roadmap needs a Council of Europe CEFR source"
);
assert.ok(
  data.courseRoadmap.sources.some((source) => source.url.includes("france-education-international.fr")),
  "Roadmap needs a France Education International DELF source"
);

const roadmapLevels = new Map(data.courseRoadmap.levels.map((level) => [level.cefrLevel, level]));
for (const level of ["A1", "A2", "B1", "B2"]) {
  assert.ok(roadmapLevels.has(level), `Roadmap must include ${level}`);
  assert.ok(roadmapLevels.get(level).modules.length >= 3, `${level} roadmap needs multiple modules`);
}
assert.equal(roadmapLevels.get("A1").status, "published");
assert.equal(roadmapLevels.get("B2").status, "planned");
assert.ok(
  data.courseRoadmap.levels.filter((level) => level.cefrLevel !== "A1").every((level) => level.status !== "published"),
  "No CEFR level beyond the completed A1 should be published before real lessons/evidence exist"
);
const roadmapSkillAxes = data.courseRoadmap.skillAxes.map((axis) => axis.id);
for (const axis of [
  "listening",
  "reading",
  "spoken-interaction",
  "spoken-production",
  "written-production",
  "mediation",
  "language-system"
]) {
  assert.ok(roadmapSkillAxes.includes(axis), `Roadmap must track ${axis}`);
  for (const level of data.courseRoadmap.levels) {
    assert.ok(
      level.exitEvidence.some((evidence) => evidence.skill === axis),
      `${level.cefrLevel} must define exit evidence for ${axis}`
    );
  }
}

const exercises = data.lessons.flatMap((lesson) => lesson.exercises);
assert.equal(exercises.length, 127, "41 lessons include 127 exercises with a seven-part checkpoint");
assert.ok(exercises.length >= data.lessons.length, "Every lesson needs assessable practice");
for (const exercise of exercises) {
  assert.ok(exercise.id, "Every exercise needs a stable id");
  assert.ok(Array.isArray(exercise.acceptedAnswers));
  assert.ok(exercise.modelAnswer);
  assert.ok(Array.isArray(exercise.hints) && exercise.hints.length > 0);
  assert.ok(Array.isArray(exercise.requiredTokens));
  assert.ok(Array.isArray(exercise.objectiveIds) && exercise.objectiveIds.length > 0);
  assert.ok(exercise.explanation);
  if (![
    "writing", "speaking", "substitution", "controlled-production", "conversation-prompt", "debate-roleplay",
    "guided-writing", "message-reply", "recorded-monologue", "mediation", "roleplay", "rubric-writing",
    "sentence-transform", "summarize-for-a-friend"
  ].includes(exercise.type)) {
    assert.equal(checkExercise(exercise, exercise.modelAnswer).status, "correct", `${exercise.id}: visible model answer must be accepted`);
  }
}

const publishedExerciseTypes = new Set(exercises.map((exercise) => exercise.type));
for (const type of [
  "reading-comprehension",
  "listening-comprehension",
  "dictation",
  "gap-fill",
  "roleplay",
  "summarize-for-a-friend"
]) {
  assert.ok(publishedExerciseTypes.has(type), `Third-wave Starter content must exercise ${type}`);
}

assert.equal(
  checkExercise(exerciseById(data, "l09-e1"), "trois euros").status,
  "correct",
  "Reading comprehension should accept the model answer"
);
assert.equal(checkExercise(exerciseById(data, "l09-e2"), "ça").status, "correct");
assert.deepEqual(
  pickCheckState(checkExercise(exerciseById(data, "l09-e3"), "Combien ça coûte ? Je voudrais payer par carte.")),
  { status: "open", needsReview: true, coverageComplete: true },
  "Roleplay must stay self-reviewed even when all support tokens are present"
);
assert.equal(
  checkExercise(exerciseById(data, "l10-e1"), "de neuf heures à midi").status,
  "correct",
  "Listening comprehension should accept the target information"
);
assert.equal(checkExercise(exerciseById(data, "l10-e2"), "Le magasin est ouvert de neuf heures à midi.").status, "correct");
assert.deepEqual(
  pickCheckState(checkExercise(exerciseById(data, "l10-e3"), "Le magasin est ouvert de neuf heures à midi. Aujourd'hui, il est fermé l'après-midi.")),
  { status: "open", needsReview: true, coverageComplete: true },
  "Message replies must require self-review instead of pretending to auto-grade meaning"
);
assert.deepEqual(
  pickCheckState(checkExercise(exerciseById(data, "l11-e1"), "Le café coûte deux euros. Le métro est à gauche. J'ai besoin d'aide.")),
  { status: "open", needsReview: true, coverageComplete: true },
  "Summarize-for-a-friend tasks must require self-review instead of pretending to auto-grade meaning"
);

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

const unknownObjectiveSkillAxis = structuredClone(data);
unknownObjectiveSkillAxis.lessons[0].objectives[0].skill = "telepathy";
assert.ok(
  collectCourseValidationErrors(unknownObjectiveSkillAxis).some((error) => error.includes("unknown skill axis")),
  "Lesson objectives must reference a declared courseRoadmap skill axis"
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
  order: 3,
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

const unsupportedExerciseType = structuredClone(data);
exerciseById(unsupportedExerciseType, "l09-e2").type = "telepathy-drill";
assert.ok(
  collectCourseValidationErrors(unsupportedExerciseType).some((error) => error.includes("unsupported exercise type")),
  "Unsupported exercise types must be rejected"
);

const missingReadingSource = structuredClone(data);
delete exerciseById(missingReadingSource, "l09-e1").sourceText;
assert.ok(
  collectCourseValidationErrors(missingReadingSource).some((error) => error.includes("sourceText")),
  "Reading comprehension must include source text"
);

const missingListeningTranscript = structuredClone(data);
delete exerciseById(missingListeningTranscript, "l10-e1").transcript;
assert.ok(
  collectCourseValidationErrors(missingListeningTranscript).some((error) => error.includes("transcript")),
  "Listening comprehension must include a transcript for after-attempt review"
);

const missingRoleplayRubric = structuredClone(data);
delete exerciseById(missingRoleplayRubric, "l09-e3").rubric;
assert.ok(
  collectCourseValidationErrors(missingRoleplayRubric).some((error) => error.includes("requires review criteria")),
  "Open roleplay must include self-review criteria"
);

const unsupportedRoadmapLevel = structuredClone(data);
unsupportedRoadmapLevel.courseRoadmap.levels[0].cefrLevel = "C3";
assert.ok(
  collectCourseValidationErrors(unsupportedRoadmapLevel).some((error) => error.includes("unsupported level")),
  "Roadmap must not introduce unsupported CEFR levels"
);

const brokenRoadmapSkill = structuredClone(data);
brokenRoadmapSkill.courseRoadmap.levels[0].modules[0].skillFocus = ["telepathy"];
assert.ok(
  collectCourseValidationErrors(brokenRoadmapSkill).some((error) => error.includes("unknown skill axis")),
  "Roadmap modules must reference declared skill axes"
);

const missingRoadmapEvidence = structuredClone(data);
missingRoadmapEvidence.courseRoadmap.levels[0].exitEvidence = missingRoadmapEvidence.courseRoadmap.levels[0].exitEvidence.filter(
  (evidence) => evidence.skill !== "listening"
);
assert.ok(
  collectCourseValidationErrors(missingRoadmapEvidence).some((error) => error.includes("missing evidence")),
  "Every roadmap level must define exit evidence for every tracked skill axis"
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
assert.equal(new Set(queue.map((card) => card.noteId)).size, 10, "Only ten distinct new words should be introduced per day");
assert.equal(queue.length, 20, "Both directions of each of the ten new words are queued together");

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
const firstCardAfterAgain = reviewSchedule(firstSchedule, "again", now, createScheduler({ enable_fuzz: false }));
const queueWithAgainPriority = buildReviewQueue({
  cards,
  schedules: new Map([
    [overdue.id, overdue],
    [cards[0].id, firstCardAfterAgain.schedule]
  ]),
  logs: [{ cardId: cards[0].id, wasNew: true, reviewedAt: now.toISOString() }],
  now: new Date(firstCardAfterAgain.schedule.due),
  newLimit: 10,
  cram: false,
  seen: new Set()
});
assert.equal(queueWithAgainPriority[0].id, cards[0].id, "A due Again card must outrank ordinary overdue cards");
const queueWithAgainMarkedSeen = buildReviewQueue({
  cards,
  schedules: new Map([[cards[0].id, firstCardAfterAgain.schedule]]),
  logs: [{ cardId: cards[0].id, wasNew: true, reviewedAt: now.toISOString() }],
  now: new Date(firstCardAfterAgain.schedule.due),
  newLimit: 10,
  cram: false,
  seen: new Set([cards[0].id])
});
assert.equal(queueWithAgainMarkedSeen[0].id, cards[0].id, "A due Again card must return even when a stale session marks it seen");
const queueWithSkippedDue = buildReviewQueue({
  cards,
  schedules: new Map([
    [overdue.id, overdue],
    [cards[0].id, firstCardAfterAgain.schedule]
  ]),
  logs: [{ cardId: cards[0].id, wasNew: true, reviewedAt: now.toISOString() }],
  now: new Date(firstCardAfterAgain.schedule.due),
  newLimit: 10,
  cram: false,
  seen: new Set([overdue.id])
});
assert.equal(queueWithSkippedDue.length >= 2, true, "Skipped due cards stay in the session instead of disappearing");
assert.equal(queueWithSkippedDue[1].id, overdue.id, "Skip moves an ordinary due card behind unskipped due cards");
const sixteenDueCards = cards.slice(0, 16);
const allSixteenMarkedSeen = buildReviewQueue({
  cards: sixteenDueCards,
  schedules: new Map(sixteenDueCards.map((card) => [card.id, { ...overdue, id: card.id }])),
  logs: [],
  now,
  newLimit: 0,
  cram: false,
  seen: new Set(sixteenDueCards.map((card) => card.id))
});
assert.equal(allSixteenMarkedSeen.length, 16, "All 16 due cards stay available even after they were skipped in this session");
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

const malformedParadigmCatalog = JSON.parse(JSON.stringify(data));
malformedParadigmCatalog.pronunciationTopics[0].paradigm = [{ label: "начало слова" }];
const paradigmErrors = collectCourseValidationErrors(malformedParadigmCatalog);
assert.ok(
  paradigmErrors.some((error) => error.includes("pronunciationTopics[0].paradigm[0].form")),
  "Malformed paradigm entry (missing form) must be reported"
);

const malformedMistakeCatalog = JSON.parse(JSON.stringify(data));
malformedMistakeCatalog.grammarTopics[0].commonMistakes = [{ wrong: "x", right: "y" }];
const mistakeErrors = collectCourseValidationErrors(malformedMistakeCatalog);
assert.ok(
  mistakeErrors.some((error) => error.includes("grammarTopics[0].commonMistakes[0].note")),
  "Malformed commonMistakes entry (missing note) must be reported"
);

const emptyParadigmCatalog = JSON.parse(JSON.stringify(data));
emptyParadigmCatalog.grammarTopics[0].paradigm = [];
const emptyErrors = collectCourseValidationErrors(emptyParadigmCatalog);
assert.ok(
  emptyErrors.some((error) => error.includes("grammarTopics[0].paradigm: expected at least one item")),
  "Empty paradigm array must be reported"
);

const wellFormedCatalog = JSON.parse(JSON.stringify(data));
wellFormedCatalog.pronunciationTopics[0].paradigm = [{ label: "начало слова", form: "rue" }];
wellFormedCatalog.pronunciationTopics[0].commonMistakes = [{ wrong: "x", right: "y", note: "z" }];
wellFormedCatalog.pronunciationTopics[0].exceptions = [{ wrong: "x", right: "y", note: "z" }];
const wellFormedErrors = collectCourseValidationErrors(wellFormedCatalog);
assert.ok(
  !wellFormedErrors.some((error) => error.startsWith("pronunciationTopics[0].paradigm"))
    && !wellFormedErrors.some((error) => error.startsWith("pronunciationTopics[0].commonMistakes"))
    && !wellFormedErrors.some((error) => error.startsWith("pronunciationTopics[0].exceptions")),
  "Well-formed paradigm/commonMistakes/exceptions must not raise errors"
);

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

function exerciseById(catalog, id) {
  const exercise = catalog.lessons.flatMap((lesson) => lesson.exercises).find((item) => item.id === id);
  assert.ok(exercise, `Missing exercise fixture: ${id}`);
  return exercise;
}

function pickCheckState(result) {
  return {
    status: result.status,
    needsReview: result.needsReview,
    coverageComplete: result.coverageComplete
  };
}
