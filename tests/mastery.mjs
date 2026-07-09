import assert from "node:assert/strict";
import {
  areLessonPrerequisitesMet,
  checkCatalogLessonPrerequisites,
  checkLessonPrerequisites,
  evaluateLessonReadiness,
  getIntroducedLessonIds
} from "../mastery.js";

const lesson = {
  id: "lesson-1",
  objectives: [
    { id: "obj:closed-1", required: true },
    { id: "obj:closed-2", required: true },
    { id: "obj:writing", required: true },
    { id: "obj:speaking", required: true },
    { id: "obj:optional", required: false }
  ],
  exercises: [
    { id: "closed-1", type: "translate", objectiveIds: ["obj:closed-1"] },
    { id: "closed-2", type: "substitution", objectiveIds: ["obj:closed-2"] },
    { id: "open-writing", type: "writing", objectiveIds: ["obj:writing"] },
    { id: "open-speaking", type: "speaking", objectiveIds: ["obj:speaking"] },
    { id: "optional", type: "translate", required: false, objectiveIds: ["obj:optional"] }
  ]
};

const attempts = [
  { id: "closed-1", result: { status: "correct" } },
  { id: "closed-2", result: { status: "almost" } },
  { id: "open-writing", result: { status: "open", needsReview: true, coverageComplete: true }, selfReviewed: false },
  { id: "open-speaking", result: { status: "open", needsReview: true, coverageComplete: true }, selfReviewed: true },
  { id: "optional", result: { status: "incorrect" } },
  { id: "unknown-exercise", result: { status: "correct" } }
];

assert.deepEqual(evaluateLessonReadiness(lesson, attempts), {
  lessonId: "lesson-1",
  total: 4,
  mastered: 2,
  needsReview: 1,
  incomplete: 1,
  canComplete: false,
  evidence: [
    { exerciseId: "closed-1", state: "mastered" },
    { exerciseId: "closed-2", state: "incomplete" },
    { exerciseId: "open-writing", state: "needs-review" },
    { exerciseId: "open-speaking", state: "mastered" }
  ],
  objectives: {
    total: 4,
    mastered: 2,
    needsReview: 1,
    incomplete: 1,
    evidence: [
      { objectiveId: "obj:closed-1", state: "mastered", exerciseIds: ["closed-1"] },
      { objectiveId: "obj:closed-2", state: "incomplete", exerciseIds: ["closed-2"] },
      { objectiveId: "obj:writing", state: "needs-review", exerciseIds: ["open-writing"] },
      { objectiveId: "obj:speaking", state: "mastered", exerciseIds: ["open-speaking"] }
    ]
  }
});

const completeAttempts = new Map([
  ["closed-1", { result: { status: "correct" } }],
  ["closed-2", { result: { status: "open", needsReview: true, coverageComplete: true }, selfReviewed: true }],
  ["open-writing", { result: { status: "open", needsReview: true, coverageComplete: true }, selfReviewed: true }],
  ["open-speaking", { result: { status: "open", needsReview: true, coverageComplete: true }, selfReviewed: true }]
]);
const complete = evaluateLessonReadiness(lesson, completeAttempts);
assert.equal(complete.mastered, 4);
assert.equal(complete.incomplete, 0);
assert.equal(complete.needsReview, 0);
assert.equal(complete.canComplete, true);
assert.equal(complete.objectives.mastered, 4);

const openWithoutReviewContract = evaluateLessonReadiness(
  { id: "open-only", exercises: [{ id: "writing", type: "writing" }] },
  [{ id: "writing", result: { status: "correct" }, selfReviewed: true }]
);
assert.equal(openWithoutReviewContract.incomplete, 1);
assert.equal(openWithoutReviewContract.canComplete, false);

const pendingSelfReview = evaluateLessonReadiness(
  { id: "open-only", exercises: [{ id: "speaking", type: "speaking" }] },
  [{ id: "speaking", result: { needsReview: true, coverageComplete: true } }]
);
assert.equal(pendingSelfReview.needsReview, 1);
assert.equal(pendingSelfReview.canComplete, false);

const missingCoverageCannotBeConfirmed = evaluateLessonReadiness(
  { id: "open-only", exercises: [{ id: "writing", type: "writing" }] },
  [{ id: "writing", result: { needsReview: true, coverageComplete: false }, selfReviewed: true }]
);
assert.equal(missingCoverageCannotBeConfirmed.incomplete, 1);
assert.equal(missingCoverageCannotBeConfirmed.canComplete, false);

const history = [
  { exerciseId: "closed", result: { status: "correct" }, checkedAt: "2026-07-08T10:00:00Z" },
  { exerciseId: "closed", result: { status: "incorrect" }, checkedAt: "2026-07-08T09:00:00Z" }
];
assert.equal(
  evaluateLessonReadiness({ id: "history", exercises: [{ id: "closed", type: "translate" }] }, history).canComplete,
  true,
  "The chronologically newest attempt must win even when history is unordered"
);

assert.deepEqual(evaluateLessonReadiness(null, null), {
  lessonId: null,
  total: 0,
  mastered: 0,
  needsReview: 0,
  incomplete: 0,
  canComplete: false,
  evidence: [],
  objectives: { total: 0, mastered: 0, needsReview: 0, incomplete: 0, evidence: [] }
});
assert.equal(evaluateLessonReadiness({ exercises: [null, {}] }, "bad attempts").incomplete, 2);

const requiredObjectiveWithoutEvidence = evaluateLessonReadiness(
  {
    id: "objective-gap",
    objectives: [{ id: "obj:required", required: true }],
    exercises: [{ id: "closed", type: "translate", objectiveIds: [] }]
  },
  [{ id: "closed", result: { status: "correct" } }]
);
assert.equal(requiredObjectiveWithoutEvidence.mastered, 1);
assert.equal(requiredObjectiveWithoutEvidence.objectives.incomplete, 1);
assert.equal(requiredObjectiveWithoutEvidence.canComplete, false);

assert.deepEqual(checkLessonPrerequisites({ prerequisites: ["l01", "l02", "l02"] }, ["l01"]), {
  met: false,
  required: ["l01", "l02"],
  missing: ["l02"]
});
assert.equal(areLessonPrerequisitesMet({ prerequisites: ["l01"] }, new Set(["l01"])), true);
assert.equal(areLessonPrerequisitesMet({ prerequisites: ["l01"] }, []), false);
assert.equal(areLessonPrerequisitesMet({}, null), true);
assert.deepEqual(checkLessonPrerequisites({ prerequisites: [null, "", "l01"] }, [null, "l01"]), {
  met: true,
  required: ["l01"],
  missing: []
});

const graphCatalog = {
  levels: [
    { id: "starter", prerequisites: [] },
    { id: "advanced", prerequisites: ["starter"] }
  ],
  modules: [
    { id: "module:a", levelId: "starter", prerequisites: [] },
    { id: "module:b", levelId: "starter", prerequisites: ["module:a"] },
    { id: "module:c", levelId: "starter", prerequisites: ["module:b"] },
    { id: "module:advanced", levelId: "advanced", prerequisites: [] }
  ],
  lessons: [
    { id: "l01", moduleId: "module:a", prerequisites: [] },
    { id: "l02", moduleId: "module:a", prerequisites: [] },
    { id: "l03", moduleId: "module:b", prerequisites: [] },
    { id: "l04", moduleId: "module:c", prerequisites: ["l03"] },
    { id: "l05", moduleId: "module:advanced", prerequisites: [] }
  ]
};

const moduleLocked = checkCatalogLessonPrerequisites(graphCatalog, graphCatalog.lessons[3], ["l01"]);
assert.equal(moduleLocked.met, false);
assert.deepEqual(moduleLocked.required.sort(), ["l01", "l02", "l03"].sort());
assert.deepEqual(moduleLocked.missing.sort(), ["l02", "l03"].sort());
assert.ok(moduleLocked.reasons.some((reason) => reason.type === "module" && reason.id === "module:a"));
assert.ok(moduleLocked.reasons.some((reason) => reason.type === "module" && reason.id === "module:b"));
assert.equal(checkCatalogLessonPrerequisites(graphCatalog, graphCatalog.lessons[3], ["l01", "l02", "l03"]).met, true);

const levelLocked = checkCatalogLessonPrerequisites(graphCatalog, graphCatalog.lessons[4], ["l01", "l02"]);
assert.equal(levelLocked.met, false);
assert.deepEqual(levelLocked.missing.sort(), ["l03", "l04"].sort());
assert.ok(levelLocked.reasons.some((reason) => reason.type === "level" && reason.id === "starter"));
assert.equal(
  checkCatalogLessonPrerequisites(graphCatalog, graphCatalog.lessons[4], ["l01", "l02", "l03", "l04"]).met,
  true
);

const brokenGraph = checkCatalogLessonPrerequisites(
  { levels: [], modules: [], lessons: [] },
  { id: "broken", moduleId: "missing", prerequisites: ["prior"] },
  ["prior"]
);
assert.equal(brokenGraph.met, false);
assert.ok(brokenGraph.reasons.some((reason) => reason.type === "catalog"));
assert.doesNotThrow(() => checkCatalogLessonPrerequisites(null, null, null));

const unknownDirectLesson = checkCatalogLessonPrerequisites(
  graphCatalog,
  { ...graphCatalog.lessons[0], prerequisites: ["missing-lesson"] },
  ["missing-lesson"]
);
assert.equal(unknownDirectLesson.met, false, "A completed but unknown prerequisite id must not unlock a lesson");
assert.ok(unknownDirectLesson.reasons.some((reason) => reason.type === "catalog" && reason.id === "missing-lesson"));

assert.deepEqual(
  getIntroducedLessonIds({
    completedLessons: ["l01", "l02", "l01"],
    attempts: [
      { id: "e1", lessonId: "l02" },
      { id: "e2", lessonId: "l03" },
      null,
      { lessonId: "" }
    ],
    currentLessonId: "l04"
  }),
  ["l01", "l02", "l03", "l04"]
);
assert.deepEqual(
  getIntroducedLessonIds({
    completedLessons: new Set(["l01"]),
    attempts: new Map([
      ["e1", { lessonId: "l02" }],
      ["e2", { lessonId: "l01" }]
    ]),
    currentLessonId: "l02"
  }),
  ["l01", "l02"]
);
assert.deepEqual(getIntroducedLessonIds(), []);
assert.deepEqual(getIntroducedLessonIds({ completedLessons: "bad", attempts: {}, currentLessonId: null }), []);

console.log("Mastery tests passed.");
