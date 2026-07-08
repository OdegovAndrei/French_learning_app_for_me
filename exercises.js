export function checkExercise(exercise, input) {
  const value = String(input || "").trim();
  if (!value) {
    return { status: "empty", message: "Сначала напиши или произнеси свой вариант." };
  }

  if (["writing", "speaking"].includes(exercise.type) || (exercise.type === "substitution" && exercise.requiredTokens?.length)) {
    const required = exercise.requiredTokens || [];
    const normalized = normalizeAnswer(value);
    const matched = required.filter((token) => normalized.includes(normalizeAnswer(token)));
    const complete = matched.length === required.length;
    const accentComplete = required.every((token) =>
      stripDiacritics(normalized).includes(stripDiacritics(normalizeAnswer(token)))
    );
    return {
      status: complete ? "correct" : accentComplete ? "almost" : "open",
      message: complete
        ? "Все обязательные элементы на месте. Сравни свой вариант с примером."
        : accentComplete
          ? "Все нужные слова найдены, но проверь французские акценты и диакритику."
          : `Есть ${matched.length} из ${required.length} опорных элементов. Это открытое задание: исправь фразу и сравни с примером.`,
      matched,
      missing: accentComplete ? [] : required.filter((token) => !matched.includes(token))
    };
  }

  const accepted = exercise.acceptedAnswers || [];
  const normalizedInput = normalizeAnswer(value);
  if (accepted.some((answer) => normalizeAnswer(answer) === normalizedInput)) {
    return { status: "correct", message: exercise.explanation || "Верно." };
  }

  const accentlessInput = stripDiacritics(normalizedInput);
  const accentMatch = accepted.find((answer) => stripDiacritics(normalizeAnswer(answer)) === accentlessInput);
  if (accentMatch) {
    return {
      status: "almost",
      message: `Почти правильно. Проверь французские знаки: ${accentMatch}`
    };
  }

  return {
    status: "incorrect",
    message: exercise.hints?.[0] || "Пока не совпало. Посмотри подсказку и попробуй ещё раз."
  };
}

export function normalizeAnswer(value) {
  return String(value)
    .normalize("NFC")
    .toLocaleLowerCase("fr")
    .replace(/[’`´]/g, "'")
    .replace(/[.,!?;:«»"()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripDiacritics(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
