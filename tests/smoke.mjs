import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildAnkiTsv } from "../anki.js";
import { buildCards, buildVocabularyNotes } from "../cards.js";
import { checkExercise } from "../exercises.js";
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

assert.equal(data.lessons.length, 8, "The course should contain eight scenario lessons");
assert.equal(data.pronunciationTopics.length, 5);
assert.equal(data.grammarTopics.length, 6);

const exercises = data.lessons.flatMap((lesson) => lesson.exercises);
assert.equal(exercises.length, 24);
for (const exercise of exercises) {
  assert.ok(exercise.id, "Every exercise needs a stable id");
  assert.ok(Array.isArray(exercise.acceptedAnswers));
  assert.ok(exercise.modelAnswer);
  assert.ok(Array.isArray(exercise.hints) && exercise.hints.length > 0);
  assert.ok(Array.isArray(exercise.requiredTokens));
  assert.ok(exercise.explanation);
}

const notes = buildVocabularyNotes(data);
const cards = buildCards(data);
assert.equal(notes.length, 30, "Every vocabulary item must become a note");
assert.equal(cards.filter((card) => ["ru-fr", "fr-ru"].includes(card.kind)).length, 60);
assert.equal(cards.length, 77, "60 vocabulary directions plus 17 unique phrase cards");
assert.equal(new Set(cards.map((card) => card.id)).size, cards.length, "Card ids must be unique");

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
assert.equal(buildCards(data, [custom]).length, 79, "A custom two-way note adds two cards");

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
const coverage = checkExercise(translation, "du fromage\nde l'eau\nun sac");
assert.equal(coverage.status, "correct");

const cafeExercise = data.lessons[3].exercises[0];
const cafeCoverage = checkExercise(cafeExercise, "un cafe, de l'eau, un croissant, un the");
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
