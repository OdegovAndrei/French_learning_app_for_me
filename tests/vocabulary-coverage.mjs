import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildCards } from "../cards.js";

const data = JSON.parse(await readFile(new URL("../data/lessons.json", import.meta.url), "utf8"));
const expectedByLesson = {
  l02: ["bienvenue"],
  l04: ["bien sûr"],
  l05: ["oui", "voilà"],
  l06: ["c'est"],
  l07: ["se voir", "aller"],
  l08a: ["combien", "la salle", "il y a", "un élève", "une classe", "une chaise", "tout le monde", "une personne"],
  l08b: ["un euro", "alors", "ça fait", "en tout", "attendre", "une réduction"],
  l08c: ["une ville", "un habitant", "une région", "parisien / parisienne", "compter", "autour", "presque", "un bâtiment", "un dollar"],
  l09: ["le matin"],
  l10: ["l'après-midi"],
  l12: ["le prénom", "votre", "une fiche d'inscription", "italien / italienne"],
  l15: ["samedi", "savoir", "le centre", "une fermeture"],
  l17: ["prochain / prochaine", "non", "d'accord"],
  l18: ["une liste de courses"],
  l19: ["le soleil"],
  l20: ["voici", "une photo", "une famille"],
  l22: ["pas cher", "salut", "sympa", "à bientôt"],
  l24: ["le cours", "commencer", "septembre"],
  l25: ["premier / première", "après"],
  l27: ["chercher", "étudiant / étudiante"],
  l28: ["pouvoir"],
  l29: ["le départ", "prendre", "le tram", "changer"],
  l30: ["le train"],
  l31: ["devoir", "voir", "universitaire"],
  l32: ["ici", "une entrée", "une impression", "utiliser"],
  l33: ["préférer", "parce que", "quoi", "un sandwich"],
  l34: ["aimer"],
  l35: ["vouloir", "une autre fois"],
  l38: ["un bus", "une université", "apporter", "étudier", "se déplacer", "demander", "simple"]
};

const lessonById = new Map(data.lessons.map((lesson) => [lesson.id, lesson]));
const expectedCount = Object.values(expectedByLesson).flat().length;

assert.equal(expectedCount, 86, "Audit inventory must retain its exact 73 additions and 13 earlier moves");
for (const [lessonId, expectedTerms] of Object.entries(expectedByLesson)) {
  const lesson = lessonById.get(lessonId);
  assert.ok(lesson, `Missing lesson ${lessonId}`);
  const terms = new Set(lesson.vocabulary.map((item) => item.fr));
  for (const term of expectedTerms) {
    assert.ok(terms.has(term), `${lessonId} must introduce ${term} no later than its first use`);
  }
}

const vocabularyItems = data.lessons.flatMap((lesson) => lesson.vocabulary);
assert.equal(vocabularyItems.length, 311, "73 new vocabulary notes extend the previous 238-note catalog");
assert.equal(buildCards(data).length, 977, "The vocabulary repair yields the expected card catalog");

console.log(`Vocabulary coverage passed: ${expectedCount} first-use terms, ${vocabularyItems.length} notes, ${buildCards(data).length} cards.`);
