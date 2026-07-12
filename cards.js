export function buildVocabularyNotes(data, customNotes = []) {
  const builtIn = data.lessons.flatMap((lesson) =>
    lesson.vocabulary.map((item) => ({
      id: item.id,
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
  const manualPhraseTargets = new Set();

  for (const lesson of data.lessons) {
    lesson.cards.forEach((card) => {
      const candidate = {
        id: card.id,
        noteId: card.noteId || phraseNoteId(card.id),
        source: "builtIn",
        kind: card.type === "cloze" || card.front.includes("{{c1::") ? "cloze" : "phrase",
        direction: card.type === "cloze" || card.front.includes("{{c1::") ? null : "ru-fr",
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

      if (!isFullFrenchPhrase(candidate)) return;
      manualPhraseTargets.add(phraseTargetKey(candidate.back));
      const reverse = {
        ...candidate,
        id: `${candidate.id}:fr-ru`,
        direction: "fr-ru",
        front: candidate.back,
        back: candidate.front
      };
      const reverseSignature = cardSignature(reverse);
      if (!signatures.has(reverseSignature)) {
        signatures.add(reverseSignature);
        phraseCards.push(reverse);
      }
    });
  }

  for (const lesson of data.lessons) {
    lesson.dialogue.forEach((line) => {
      if (!isFullFrenchText(line.fr)) return;
      const target = phraseTargetKey(line.fr);
      if (manualPhraseTargets.has(target)) return;

      const noteId = `phrase-note:${lesson.id}:dialogue:${stableTextId(line.fr)}`;
      const common = {
        noteId,
        source: "builtIn",
        kind: "phrase",
        audioText: line.fr,
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        tags: [lesson.level, lesson.scenario, "dialogue", "phrase"]
      };
      const pair = [
        {
          ...common,
          id: `phrase:${lesson.id}:dialogue:${stableTextId(line.fr)}:ru-fr`,
          direction: "ru-fr",
          front: line.ru,
          back: line.fr
        },
        {
          ...common,
          id: `phrase:${lesson.id}:dialogue:${stableTextId(line.fr)}:fr-ru`,
          direction: "fr-ru",
          front: line.fr,
          back: line.ru
        }
      ];
      for (const candidate of pair) {
        const signature = cardSignature(candidate);
        if (signatures.has(signature)) continue;
        signatures.add(signature);
        phraseCards.push(candidate);
      }
    });
  }

  return [...vocabularyCards, ...phraseCards];
}

function phraseNoteId(cardId) {
  return cardId.startsWith("phrase:")
    ? `phrase-note:${cardId.slice("phrase:".length)}`
    : `phrase-note:${cardId}`;
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
  if (deck === "phrases") return cards.filter(isFullPhraseCard);
  if (deck === "custom") return cards.filter((card) => card.source === "custom");
  return cards.filter((card) => card.lessonId === deck);
}

export function isFullPhraseCard(card) {
  return card.kind === "phrase" && isFullFrenchText(card.audioText);
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

function isFullFrenchPhrase(card) {
  return card.kind === "phrase" && isFullFrenchText(card.back);
}

function isFullFrenchText(value) {
  return /[A-Za-zÀ-ÿ]/.test(String(value)) && phraseWordCount(value) > 2;
}

function phraseWordCount(value) {
  return String(value).match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length || 0;
}

function phraseTargetKey(value) {
  return cleanCloze(value)
    .normalize("NFC")
    .toLocaleLowerCase("fr")
    .replace(/[’']/g, "'")
    .replace(/[.,!?;:]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stableTextId(value) {
  let hash = 2166136261;
  for (const character of phraseTargetKey(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
