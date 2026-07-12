import { Rating, State, createEmptyCard, fsrs } from "./vendor/ts-fsrs/index.mjs";

const ratingMap = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy
};

export function createScheduler(options = {}) {
  return fsrs({ request_retention: 0.9, ...options });
}

export function createSchedule(cardId, now = new Date()) {
  const card = createEmptyCard(now);
  return { id: cardId, ...serializeFsrsCard(card) };
}

export function previewSchedule(schedule, now = new Date(), scheduler = createScheduler()) {
  const card = deserializeFsrsCard(schedule || createSchedule("preview", now));
  const preview = scheduler.repeat(card, now);
  return Object.fromEntries(
    Object.entries(ratingMap).map(([name, rating]) => [
      name,
      {
        due: preview[rating].card.due,
        interval: formatInterval(preview[rating].card.due.getTime() - now.getTime())
      }
    ])
  );
}

export function reviewSchedule(schedule, ratingName, now = new Date(), scheduler = createScheduler()) {
  const rating = ratingMap[ratingName];
  if (!rating) throw new Error(`Unknown rating: ${ratingName}`);
  const input = deserializeFsrsCard(schedule);
  const wasNew = input.state === State.New && input.reps === 0;
  const result = scheduler.next(input, now, rating);
  return {
    schedule: { id: schedule.id, ...serializeFsrsCard(result.card) },
    log: {
      cardId: schedule.id,
      rating: ratingName,
      ratingValue: rating,
      wasNew,
      reviewedAt: now.toISOString(),
      dueBefore: result.log.due.toISOString(),
      dueAfter: result.card.due.toISOString(),
      stateBefore: result.log.state,
      scheduledDays: result.log.scheduled_days,
      stability: result.log.stability,
      difficulty: result.log.difficulty
    }
  };
}

export function resetSchedule(cardId, now = new Date()) {
  return createSchedule(cardId, now);
}

export function isNewSchedule(schedule) {
  return !schedule || schedule.state === State.New || schedule.reps === 0;
}

export function isDueSchedule(schedule, now = new Date()) {
  return schedule && !isNewSchedule(schedule) && new Date(schedule.due).getTime() <= now.getTime();
}

export function isLearningSchedule(schedule) {
  return schedule?.state === State.Learning || schedule?.state === State.Relearning;
}

const SCHEDULE_STATE_LABELS = {
  [State.New]: "Новое",
  [State.Learning]: "Изучение",
  [State.Review]: "Повторение",
  [State.Relearning]: "Переизучение"
};

export function buildUnlockedWordRows({ cards, schedules, now = new Date() }) {
  const groupOrder = [];
  const groups = new Map();
  for (const card of cards) {
    const key = card.lessonId || "custom";
    if (!groups.has(key)) {
      groups.set(key, { label: card.lessonTitle || "Свои слова", cards: [] });
      groupOrder.push(key);
    }
    groups.get(key).cards.push(card);
  }
  const orderedKeys = [
    ...groupOrder.filter((key) => key !== "custom"),
    ...groupOrder.filter((key) => key === "custom")
  ];

  return orderedKeys.flatMap((key) => {
    const group = groups.get(key);
    const sortedCards = [...group.cards].sort((a, b) => a.front.localeCompare(b.front, "fr"));
    return sortedCards.map((card) => {
      const schedule = schedules.get(card.id);
      return {
        id: card.id,
        front: card.front,
        back: card.back,
        groupLabel: group.label,
        statusLabel: SCHEDULE_STATE_LABELS[schedule?.state] || SCHEDULE_STATE_LABELS[State.New],
        remainingLabel: unlockedWordRemainingLabel(schedule, now)
      };
    });
  });
}

export function buildUnlockedPhraseRows({ cards, schedules, now = new Date() }) {
  const groupOrder = [];
  const groups = new Map();

  for (const card of cards) {
    const key = card.lessonId || "custom";
    if (!groups.has(key)) {
      groups.set(key, { label: card.lessonTitle || "Свои фразы", notes: new Map() });
      groupOrder.push(key);
    }
    const group = groups.get(key);
    if (!group.notes.has(card.noteId)) group.notes.set(card.noteId, []);
    group.notes.get(card.noteId).push(card);
  }

  const orderedKeys = [
    ...groupOrder.filter((key) => key !== "custom"),
    ...groupOrder.filter((key) => key === "custom")
  ];

  return orderedKeys.flatMap((key) => {
    const group = groups.get(key);
    return [...group.notes.values()]
      .map((noteCards) => phraseRow(noteCards, group.label, schedules, now))
      .sort((first, second) => first.french.localeCompare(second.french, "fr"));
  });
}

function unlockedWordRemainingLabel(schedule, now) {
  if (isNewSchedule(schedule)) return "Новое";
  if (isDueSchedule(schedule, now)) return "Пора повторить";
  return `через ${formatInterval(new Date(schedule.due).getTime() - now.getTime())}`;
}

function phraseRow(cards, groupLabel, schedules, now) {
  const orderedCards = [...cards].sort((first, second) => {
    const firstDirection = first.direction === "ru-fr" ? 0 : 1;
    const secondDirection = second.direction === "ru-fr" ? 0 : 1;
    return firstDirection - secondDirection;
  });
  const production = orderedCards.find((card) => card.direction === "ru-fr") || orderedCards[0];
  const french = production.direction === "fr-ru" ? production.front : production.back;
  const russian = production.direction === "fr-ru" ? production.back : production.front;
  return {
    id: production.noteId,
    french,
    russian,
    audioText: production.audioText || french,
    groupLabel,
    reviewLabel: orderedCards.map((card) => {
      const direction = card.direction === "fr-ru" ? "французский → русский" : "русский → французский";
      const schedule = schedules.get(card.id);
      return `${direction}: ${SCHEDULE_STATE_LABELS[schedule?.state] || SCHEDULE_STATE_LABELS[State.New]} · ${unlockedWordRemainingLabel(schedule, now)}`;
    }).join("\n")
  };
}

export function countNewIntroducedToday(logs, cardsById, now = new Date()) {
  const day = localDateKey(now);
  return new Set(
    logs
      .filter((log) => log.wasNew && localDateKey(new Date(log.reviewedAt)) === day)
      .map((log) => cardsById.get(log.cardId)?.noteId || log.cardId)
  ).size;
}

export function buildReviewQueue({ cards, schedules, logs, now = new Date(), newLimit = 10, cram = false, seen = new Set() }) {
  const active = cards;
  if (cram) return active.filter((card) => !seen.has(card.id));

  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const due = active
    .filter((card) => isDueSchedule(schedules.get(card.id), now))
    .sort((a, b) => {
      const aSchedule = schedules.get(a.id);
      const bSchedule = schedules.get(b.id);
      const priorityDifference = Number(isLearningSchedule(bSchedule)) - Number(isLearningSchedule(aSchedule));
      if (priorityDifference) return priorityDifference;
      const skippedDifference = Number(seen.has(a.id)) - Number(seen.has(b.id));
      if (skippedDifference) return skippedDifference;
      return new Date(aSchedule.due) - new Date(bSchedule.due);
    });

  const introduced = countNewIntroducedToday(logs, cardsById, now);
  const slots = Math.max(0, newLimit - introduced);
  const newCards = [];
  const newNoteIds = new Set();

  for (const card of active) {
    if (seen.has(card.id)) continue;
    if (!isNewSchedule(schedules.get(card.id))) continue;
    if (!newNoteIds.has(card.noteId)) {
      if (newNoteIds.size >= slots) continue;
      newNoteIds.add(card.noteId);
    }
    newCards.push(card);
  }

  return [...due, ...newCards];
}

export function serializeFsrsCard(card) {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review?.toISOString() || null
  };
}

export function deserializeFsrsCard(card) {
  return {
    ...card,
    due: new Date(card.due),
    last_review: card.last_review ? new Date(card.last_review) : undefined
  };
}

export function formatInterval(milliseconds) {
  const minutes = Math.max(1, Math.round(milliseconds / 60000));
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days} дн`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} мес`;
  return `${Math.round(days / 365)} г`;
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
