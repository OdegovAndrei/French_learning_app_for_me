export function checkExercise(exercise, input) {
  const value = String(input || "").trim();
  if (!value) {
    return { status: "empty", message: "Сначала напиши или произнеси свой вариант." };
  }

  const isOpenEnded = [
    "writing",
    "speaking",
    "substitution",
    "controlled-production",
    "conversation-prompt",
    "debate-roleplay",
    "guided-writing",
    "message-reply",
    "recorded-monologue",
    "mediation",
    "roleplay",
    "rubric-writing",
    "sentence-transform",
    "summarize-for-a-friend"
  ].includes(exercise.type);
  if (isOpenEnded || (exercise.type === "substitution" && exercise.requiredTokens?.length)) {
    const required = exercise.requiredTokens || [];
    const normalized = normalizeAnswer(value);
    const matched = required.filter((token) => containsRequiredToken(normalized, normalizeAnswer(token)));
    const complete = matched.length === required.length;
    const accentless = stripDiacritics(normalized);
    const accentComplete = required.every((token) =>
      containsRequiredToken(accentless, stripDiacritics(normalizeAnswer(token)))
    );
    const missing = required.filter((token) => !matched.includes(token));

    if (isOpenEnded) {
      if (!required.length) {
        return {
          status: "open",
          message: "Это открытое задание. Сравни ответ с примером: автоматическая проверка не может оценить грамматику и выполнение задачи.",
          matched: [],
          missing: [],
          coverageComplete: false,
          needsReview: true
        };
      }

      if (complete) {
        return {
          status: "open",
          message: "Все опорные элементы найдены, но это ещё не подтверждает правильность ответа. Проверь грамматику, смысл и сравни с примером.",
          matched,
          missing: [],
          coverageComplete: true,
          needsReview: true
        };
      }

      if (accentComplete) {
        return {
          status: "almost",
          message: "Все опорные элементы найдены, но проверь французские акценты и диакритику, затем сравни ответ с примером.",
          matched,
          missing: [],
          coverageComplete: false,
          needsReview: true
        };
      }

      return {
        status: "open",
        message: `Есть ${matched.length} из ${required.length} опорных элементов. Добавь недостающие элементы, затем проверь грамматику и смысл по примеру.`,
        matched,
        missing,
        coverageComplete: false,
        needsReview: true
      };
    }

    return {
      status: complete ? "correct" : accentComplete ? "almost" : "open",
      message: complete
        ? "Все обязательные элементы на месте. Сравни свой вариант с примером."
        : accentComplete
          ? "Все нужные слова найдены, но проверь французские акценты и диакритику."
          : `Есть ${matched.length} из ${required.length} опорных элементов. Это открытое задание: исправь фразу и сравни с примером.`,
      matched,
      missing: accentComplete ? [] : missing
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

function containsRequiredToken(answer, token) {
  if (!token) return false;
  const pattern = escapeRegExp(token).replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${pattern}(?=$|[^\\p{L}\\p{N}])`, "u").test(answer);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
