import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { checkExercise } from "../exercises.js";

const raw = await readFile(new URL("../data/lessons.json", import.meta.url), "utf8");
const data = JSON.parse(raw);
const exercise = (lessonId, exerciseId) =>
  data.lessons.find((lesson) => lesson.id === lessonId).exercises.find((item) => item.id === exerciseId);

const formalQuestion = exercise("l03", "l03-e3");
const oneWord = checkExercise(formalQuestion, "vous");
assert.equal(oneWord.status, "open", "A required keyword alone must not mark open writing as correct");
assert.equal(oneWord.needsReview, true);
assert.equal(oneWord.coverageComplete, false);

const cafeWriting = exercise("l04", "l04-e3");
const embeddedEt = checkExercise(cafeWriting, "Je voudrais une baguette, s'il vous plaît.");
assert.equal(embeddedEt.status, "open");
assert.deepEqual(embeddedEt.missing, ["et"], "et must not match inside baguette");

const completeCafeWriting = checkExercise(
  cafeWriting,
  "Je voudrais un café et une baguette, s’il vous plaît."
);
assert.equal(completeCafeWriting.status, "open", "Open writing needs human or self review even with full token coverage");
assert.equal(completeCafeWriting.needsReview, true);
assert.equal(completeCafeWriting.coverageComplete, true);
assert.deepEqual(completeCafeWriting.missing, []);

const introduction = {
  type: "speaking",
  requiredTokens: ["je m'appelle", "je suis"]
};
const curlyApostrophe = checkExercise(introduction, "Je m’appelle Léa. Je suis étudiante.");
assert.equal(curlyApostrophe.status, "open");
assert.deepEqual(curlyApostrophe.matched, ["je m'appelle", "je suis"]);

const substitution = exercise("l04", "l04-e1");
const missingAccent = checkExercise(
  substitution,
  "Je voudrais un cafe. Je voudrais de l'eau. Je voudrais un croissant. Je voudrais un thé."
);
assert.equal(missingAccent.status, "almost", "Missing accents should remain a distinct result");
assert.equal(missingAccent.coverageComplete, false);

const unstructuredSubstitution = checkExercise(
  substitution,
  "je voudrais un café de l'eau un croissant un thé"
);
assert.equal(unstructuredSubstitution.status, "open");
assert.equal(unstructuredSubstitution.coverageComplete, true);
assert.equal(unstructuredSubstitution.needsReview, true, "Substitution must require comparison with the model");

const exactTranslation = exercise("l01", "l01-e1");
assert.equal(checkExercise(exactTranslation, "Bonjour merci au revoir").status, "correct");

const accentTranslation = {
  type: "translate",
  acceptedAnswers: ["Un café"],
  hints: ["Accent needed"]
};
assert.equal(checkExercise(accentTranslation, "un cafe").status, "almost");

console.log("Exercise adversarial tests passed.");
