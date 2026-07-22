export const HELP_STEP_LABELS = Object.freeze(["Подход", "Фокус", "Каркас"]);

export function getExerciseHints(exercise) {
  if (!Array.isArray(exercise?.hints)) return [];
  return exercise.hints
    .filter((hint) => typeof hint === "string" && hint.trim())
    .slice(0, HELP_STEP_LABELS.length);
}

export function getExerciseHintLevel(attempt = {}, hintCount) {
  if (!hintCount) return 0;
  // Attempts saved before the help ladder used a boolean and had already revealed help.
  const legacyLevel = attempt.showHint && attempt.hintLevel == null ? 1 : 0;
  const savedLevel = getNonNegativeInteger(attempt.hintLevel, legacyLevel);
  return Math.min(hintCount, savedLevel);
}

export function getAvailableHintCount(attempt = {}, hintCount) {
  if (!hintCount) return 0;
  const failedAttempts = getNonNegativeInteger(attempt.helpFailures);
  return Math.min(hintCount, 1 + failedAttempts);
}

export function getNonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

export function getHintButtonLabel(hintCount, hintLevel, availableHintCount) {
  if (hintLevel === 0) return "Помочь начать";
  if (hintLevel < availableHintCount) return "Ещё один шаг";
  if (hintLevel >= hintCount) return "Вся помощь открыта";
  return "Следующий шаг после попытки";
}

export function shouldUnlockNextHint(result) {
  return ["incorrect", "almost"].includes(result?.status)
    || (result?.status === "open" && result?.coverageComplete === false);
}
