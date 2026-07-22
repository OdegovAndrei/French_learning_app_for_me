import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildCards } from "../cards.js";
import { validateCourseCatalog } from "../course-validator.js";
import { checkExercise } from "../exercises.js";
import { buildCumulativeReviewQueue, createSchedule } from "../srs.js";

const course = JSON.parse(await readFile(new URL("../data/a2/course.json", import.meta.url), "utf8"));
const matrix = JSON.parse(await readFile(new URL("../data/a2/can-do.json", import.meta.url), "utf8"));

assert.equal(validateCourseCatalog(course), true);
assert.equal(course.levels.length, 1);
assert.equal(course.levels[0].id, "a2");
assert.equal(course.modules.length, 6, "A2 publishes six vertical blocks across A2.1 and A2.2");
assert.equal(course.lessons.length, 36, "six vertical blocks contain thirty lessons and six bilans");
assert.equal(course.lessons.at(-1).scenario, "social-choices-bilan");
assert.equal(course.lessons.filter((lesson) => lesson.moduleId === "module:a2:housing-options").length, 6);
assert.equal(course.lessons.filter((lesson) => lesson.moduleId === "module:a2:changing-plans").length, 6);
assert.equal(course.lessons.filter((lesson) => lesson.moduleId === "module:a2:health-administration").length, 6);
assert.equal(course.lessons.filter((lesson) => lesson.moduleId === "module:a2:study-work-messages").length, 6);
assert.equal(course.lessons.filter((lesson) => lesson.moduleId === "module:a2:social-choices").length, 6);
assert.match(course.courseRoadmap.claimPolicy, /единый учебный прогресс/);
assert.equal(course.courseRoadmap.status, "published");
assert.equal(course.courseRoadmap.levels[0].status, "published");

const exercises = course.lessons.flatMap((lesson) => lesson.exercises);
assert.equal(exercises.length, 114);
assert.ok(exercises.every((exercise) => exercise.hints?.length === 3), "every A2 exercise has staged help");
assert.ok(exercises.some((exercise) => exercise.interactionTurns?.length === 3), "the block includes a multi-turn interaction");
assert.ok(exercises.some((exercise) => exercise.type === "rubric-writing" && /60–90 слов/.test(exercise.prompt)));
assert.ok(exercises.some((exercise) => exercise.type === "conversation-prompt" && exercise.requiresRecording));
assert.ok(exercises.some((exercise) => /charges comprises/i.test(exercise.sourceText || "")), "housing input includes real listing conditions");
assert.ok(course.grammarTopics.some((topic) => topic.id === "a2:comparative"));
assert.ok(course.grammarTopics.some((topic) => topic.id === "a2:y-en-intro"));
assert.ok(course.grammarTopics.some((topic) => topic.id === "a2:modal-verbs"));
assert.ok(course.grammarTopics.some((topic) => topic.id === "a2:future-plans"));
assert.ok(course.grammarTopics.some((topic) => topic.id === "a2:cause-consequence"));
assert.ok(course.grammarTopics.some((topic) => topic.id === "a2:advice-obligation"));
assert.ok(course.grammarTopics.some((topic) => topic.id === "a2:imperative"));
assert.ok(course.grammarTopics.some((topic) => topic.id === "a2:direct-object-pronouns"));
assert.ok(course.grammarTopics.some((topic) => topic.id === "a2:study-work-past"));
assert.ok(course.grammarTopics.some((topic) => topic.id === "a2:written-politeness"));
assert.ok(course.grammarTopics.some((topic) => topic.id === "a2:relative-qui-que"));
assert.ok(course.grammarTopics.some((topic) => topic.id === "a2:invitation-responses"));
assert.ok(course.grammarTopics.some((topic) => topic.id === "a2:superlative"));
assert.ok(course.grammarTopics.some((topic) => topic.id === "a2:past-background-events"));
assert.ok(exercises.some((exercise) => /autocar de remplacement/i.test(exercise.transcript || "")), "transport input includes a replacement route");
assert.ok(exercises.some((exercise) => /justificatif de domicile/i.test(exercise.sourceText || "")), "administrative input includes a real document checklist");
assert.ok(exercises.some((exercise) => /Pourriez-vous me confirmer/i.test(exercise.sourceText || "")), "study-work input includes a formal request");
assert.ok(exercises.some((exercise) => /Café-jeux/i.test(exercise.sourceText || exercise.transcript || "")), "social input includes a realistic shared choice");
assert.ok(course.courseRoadmap.levels[0].exitEvidence.some(({ evidence }) => /уместном регистре/.test(evidence)));
const brokenInteraction = structuredClone(course);
brokenInteraction.lessons[3].exercises[1].interactionTurns = [{ speaker: "Agent", prompt: "Un seul tour" }];
assert.throws(() => validateCourseCatalog(brokenInteraction), /expected at least two turns/);

for (const exercise of exercises) {
  const result = checkExercise(exercise, exercise.modelAnswer);
  if (result.needsReview) {
    assert.equal(result.coverageComplete, true, `${exercise.id}: the model must unlock self-review`);
  } else {
    assert.equal(result.status, "correct", `${exercise.id}: the model must be accepted`);
  }
}

const cards = buildCards(course);
assert.ok(cards.length >= 360, "six blocks produce a useful cumulative A2 FSRS deck");
assert.equal(new Set(cards.map((card) => card.id)).size, cards.length);

assert.equal(matrix.phases.length, 2);
assert.deepEqual(matrix.phases.map((phase) => phase.id), ["a2.1", "a2.2"]);
assert.equal(matrix.phases.flatMap((phase) => phase.blocks).length, 6);
assert.equal(matrix.phases.flatMap((phase) => phase.blocks).filter((block) => block.status === "published").length, 6);
assert.equal(matrix.phases.flatMap((phase) => phase.blocks).filter((block) => block.status === "planned").length, 0);
assert.ok(matrix.phases.flatMap((phase) => phase.blocks).every((block) => block.lessonCount === 6));
assert.match(matrix.meta.assumption, /ответственно/i);
assert.match(matrix.meta.progressPolicy, /единый учебный прогресс/i);

const now = new Date("2026-07-22T10:00:00.000Z");
const oldDue = { id: "a1:due", noteId: "a1:due", storageLevel: "a1" };
const oldNew = { id: "a1:new", noteId: "a1:new", storageLevel: "a1" };
const currentDue = { id: "a2:due", noteId: "a2:due", storageLevel: "a2" };
const currentNew = { id: "a2:new", noteId: "a2:new", storageLevel: "a2" };
const dueSchedule = (id) => ({
  ...createSchedule(id, now),
  due: "2026-07-21T10:00:00.000Z",
  state: 2,
  reps: 2
});
const schedules = new Map([
  [oldDue.id, dueSchedule(oldDue.id)],
  [currentDue.id, dueSchedule(currentDue.id)]
]);
const queue = buildCumulativeReviewQueue({
  reviewCards: [oldDue, oldNew, currentDue, currentNew],
  newCards: [currentDue, currentNew],
  schedules,
  logs: [],
  now,
  newLimit: 5
});
assert.deepEqual(queue.map((card) => card.id), [oldDue.id, currentDue.id, currentNew.id]);
assert.ok(!queue.includes(oldNew), "an A1 card that was never introduced must not consume an A2 new-card slot");

console.log(`A2 vertical blocks passed: ${course.lessons.length} lessons, ${exercises.length} exercises, ${cards.length} cards.`);
