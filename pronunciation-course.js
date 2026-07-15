const CARD_KINDS = new Set(["pattern", "word", "rule", "exception", "flow"]);

export function validatePronunciationCourse(course) {
  const errors = collectPronunciationCourseErrors(course);
  if (errors.length) {
    throw new Error(`Курс правил чтения не прошёл проверку:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
  return true;
}

export function collectPronunciationCourseErrors(course) {
  const errors = [];
  if (!isObject(course)) return ["catalog: expected an object"];
  if (!hasText(course.meta?.title)) errors.push("meta.title: expected non-empty text");
  if (!hasText(course.meta?.contentVersion)) errors.push("meta.contentVersion: expected non-empty text");

  const modules = Array.isArray(course.modules) ? course.modules : [];
  const lessons = Array.isArray(course.lessons) ? course.lessons : [];
  if (!modules.length) errors.push("modules: expected at least one module");
  if (!lessons.length) errors.push("lessons: expected at least one lesson");

  const moduleIds = new Set();
  const lessonIds = new Set();
  const cardIds = new Set();

  modules.forEach((module, index) => {
    const path = `modules[${index}]`;
    registerId(module?.id, `${path}.id`, moduleIds, errors);
    requireText(module, ["title", "description"], path, errors);
    if (!Number.isInteger(module?.order) || module.order < 1) errors.push(`${path}.order: expected a positive integer`);
  });

  lessons.forEach((lesson, index) => {
    if (hasText(lesson?.id)) lessonIds.add(lesson.id);
  });

  lessons.forEach((lesson, index) => {
    const path = `lessons[${index}]`;
    registerId(lesson?.id, `${path}.id`, new Set(lessons.slice(0, index).map((item) => item?.id)), errors);
    requireText(lesson, ["moduleId", "title", "target", "goal", "rule"], path, errors);
    if (!Number.isInteger(lesson?.order) || lesson.order < 1) errors.push(`${path}.order: expected a positive integer`);
    if (hasText(lesson?.moduleId) && !moduleIds.has(lesson.moduleId)) errors.push(`${path}.moduleId: unknown module "${lesson.moduleId}"`);
    requireTextArray(lesson?.focus, `${path}.focus`, errors);
    requireTextArray(lesson?.practice, `${path}.practice`, errors);

    if (!Array.isArray(lesson?.prerequisites)) errors.push(`${path}.prerequisites: expected an array`);
    const prerequisites = Array.isArray(lesson?.prerequisites) ? lesson.prerequisites : [];
    prerequisites.forEach((id, prerequisiteIndex) => {
      if (!lessonIds.has(id)) errors.push(`${path}.prerequisites[${prerequisiteIndex}]: unknown lesson "${id}"`);
      if (id === lesson?.id) errors.push(`${path}.prerequisites: lesson cannot require itself`);
    });

    requireStructuredArray(lesson?.spellings, `${path}.spellings`, ["pattern", "sound", "examples", "soundText"], errors);
    requireStructuredArray(lesson?.examples, `${path}.examples`, ["text", "ipa", "note"], errors);

    const cards = Array.isArray(lesson?.cards) ? lesson.cards : [];
    if (!cards.length) errors.push(`${path}.cards: expected at least one card`);
    cards.forEach((card, cardIndex) => {
      const cardPath = `${path}.cards[${cardIndex}]`;
      registerId(card?.id, `${cardPath}.id`, cardIds, errors);
      requireText(card, ["kind", "prompt", "answer", "audioText", "explanation"], cardPath, errors);
      if (hasText(card?.kind) && !CARD_KINDS.has(card.kind)) errors.push(`${cardPath}.kind: unsupported kind "${card.kind}"`);
    });
  });

  const orders = lessons.map((lesson) => lesson?.order).filter(Number.isInteger);
  if (new Set(orders).size !== orders.length) errors.push("lessons: lesson order values must be unique");
  return errors;
}

export function buildPronunciationCards(course) {
  const modules = new Map(course.modules.map((module) => [module.id, module]));
  return course.lessons.flatMap((lesson) => lesson.cards.map((card) => ({
    ...card,
    noteId: card.id,
    source: "pronunciation",
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    moduleId: lesson.moduleId,
    moduleTitle: modules.get(lesson.moduleId)?.title || lesson.moduleId
  })));
}

export function filterPronunciationCards(cards, { deck = "all", kind = "all" } = {}) {
  return cards.filter((card) => {
    const inDeck = deck === "all" || card.moduleId === deck || card.lessonId === deck;
    return inDeck && (kind === "all" || card.kind === kind);
  });
}

export function introducedPronunciationCards(course, completedLessonIds) {
  const completed = new Set(completedLessonIds);
  return buildPronunciationCards(course).filter((card) => completed.has(card.lessonId));
}

function registerId(value, path, seen, errors) {
  if (!hasText(value)) {
    errors.push(`${path}: expected non-empty text`);
    return;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(value)) errors.push(`${path}: invalid id "${value}"`);
  if (seen.has(value)) errors.push(`${path}: duplicate id "${value}"`);
  seen.add(value);
}

function requireText(object, fields, path, errors) {
  fields.forEach((field) => {
    if (!hasText(object?.[field])) errors.push(`${path}.${field}: expected non-empty text`);
  });
}

function requireTextArray(value, path, errors) {
  if (!Array.isArray(value) || !value.length || value.some((item) => !hasText(item))) {
    errors.push(`${path}: expected a non-empty text array`);
  }
}

function requireStructuredArray(value, path, fields, errors) {
  if (!Array.isArray(value) || !value.length) {
    errors.push(`${path}: expected at least one item`);
    return;
  }
  value.forEach((item, index) => requireText(item, fields, `${path}[${index}]`, errors));
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
