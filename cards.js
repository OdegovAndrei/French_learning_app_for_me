export function buildVocabularyNotes(data, customNotes = []) {
  const builtIn = data.lessons.flatMap((lesson) =>
    lesson.vocabulary.map((item, index) => ({
      id: `vocab:${lesson.id}:${index}`,
      source: "builtIn",
      lessonId: lesson.id,
      lessonTitle: lesson.title,
      fr: item.fr,
      ru: item.ru,
      ipa: item.ipa,
      note: item.note,
      tags: [lesson.level, lesson.scenario],
      directions: ["ru-fr", "fr-ru"]
    }))
  );
  return [...builtIn, ...customNotes];
}

export function buildCards(data, customNotes = []) {
  const notes = buildVocabularyNotes(data, customNotes);
  const vocabularyCards = notes.flatMap(cardsFromVocabularyNote);
  const signatures = new Set(vocabularyCards.map(cardSignature));
  const phraseCards = [];

  for (const lesson of data.lessons) {
    lesson.cards.forEach((card, index) => {
      const candidate = {
        id: `phrase:${lesson.id}:${index}`,
        noteId: `phrase-note:${lesson.id}:${index}`,
        source: "builtIn",
        kind: card.type === "cloze" || card.front.includes("{{c1::") ? "cloze" : "phrase",
        front: card.front,
        back: card.back,
        audioText: cleanCloze(card.back.match(/[À-ÿA-Za-z]/) ? card.back : card.front),
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        tags: [lesson.level, lesson.scenario, card.type]
      };
      const signature = cardSignature(candidate);
      if (!signatures.has(signature)) {
        signatures.add(signature);
        phraseCards.push(candidate);
      }
    });
  }

  return [...vocabularyCards, ...phraseCards];
}

export function cardsFromVocabularyNote(note) {
  const directions = note.directions?.length ? note.directions : ["ru-fr", "fr-ru"];
  return directions.map((direction) => ({
    id: `${note.id}:${direction}`,
    noteId: note.id,
    source: note.source,
    kind: direction,
    front: direction === "ru-fr" ? note.ru : note.fr,
    back: direction === "ru-fr" ? formatFrenchBack(note) : note.ru,
    audioText: note.fr,
    lessonId: note.lessonId || "custom",
    lessonTitle: note.lessonTitle || "Свои слова",
    tags: [...(note.tags || []), direction]
  }));
}

export function filterCards(cards, deck) {
  if (!deck || deck === "all") return cards;
  if (deck === "vocabulary") return cards.filter((card) => ["ru-fr", "fr-ru"].includes(card.kind));
  if (deck === "phrases") return cards.filter((card) => ["phrase", "cloze"].includes(card.kind));
  if (deck === "custom") return cards.filter((card) => card.source === "custom");
  return cards.filter((card) => card.lessonId === deck);
}

export function normalizeCardText(value) {
  return String(value)
    .normalize("NFC")
    .toLocaleLowerCase("fr")
    .replace(/[’']/g, "'")
    .replace(/[.,!?;:]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function renderClozeFront(value) {
  return String(value).replace(/\{\{c\d+::([^}:]+)(?:::[^}]+)?}}/g, "[…]");
}

export function revealCloze(value) {
  return String(value).replace(/\{\{c\d+::([^}:]+)(?:::[^}]+)?}}/g, "$1");
}

function formatFrenchBack(note) {
  return note.ipa ? `${note.fr}\n${note.ipa}` : note.fr;
}

function cardSignature(card) {
  return `${dedupeText(card.front)}|${dedupeText(cleanCloze(card.back))}`;
}

function dedupeText(value) {
  return String(value)
    .normalize("NFC")
    .toLocaleLowerCase("fr")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanCloze(value) {
  return revealCloze(value).replace(/\n.*$/s, "");
}
