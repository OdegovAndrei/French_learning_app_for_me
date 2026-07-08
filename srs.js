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

export function countNewIntroducedToday(logs, now = new Date()) {
  const day = localDateKey(now);
  return new Set(
    logs.filter((log) => log.wasNew && localDateKey(new Date(log.reviewedAt)) === day).map((log) => log.cardId)
  ).size;
}

export function reviewedNoteIdsToday(logs, cardsById, now = new Date()) {
  const day = localDateKey(now);
  return new Set(
    logs
      .filter((log) => localDateKey(new Date(log.reviewedAt)) === day)
      .map((log) => cardsById.get(log.cardId)?.noteId)
      .filter(Boolean)
  );
}

export function buildReviewQueue({ cards, schedules, logs, now = new Date(), newLimit = 10, cram = false, seen = new Set() }) {
  const active = cards.filter((card) => !seen.has(card.id));
  if (cram) return active;

  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const reviewedNotes = reviewedNoteIdsToday(logs, cardsById, now);
  const available = active.filter((card) => !reviewedNotes.has(card.noteId));
  const due = available
    .filter((card) => isDueSchedule(schedules.get(card.id), now))
    .sort((a, b) => new Date(schedules.get(a.id).due) - new Date(schedules.get(b.id).due));

  const introduced = countNewIntroducedToday(logs, now);
  const slots = Math.max(0, newLimit - introduced);
  const newCards = [];
  const selectedNotes = new Set(due.map((card) => card.noteId));

  for (const card of available) {
    if (newCards.length >= slots) break;
    if (!isNewSchedule(schedules.get(card.id))) continue;
    if (reviewedNotes.has(card.noteId) || selectedNotes.has(card.noteId)) continue;
    newCards.push(card);
    selectedNotes.add(card.noteId);
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
