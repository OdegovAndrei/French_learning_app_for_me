import {
  ALLOWED_EXERCISE_TYPES,
  ALLOWED_LEVELS,
  COURSE_SCHEMA,
  COURSE_SCHEMA_VERSION,
  ROADMAP_LEVEL_STATUSES
} from "./course-schema.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]*$/;
const ORAL_EXERCISE_TYPES = new Set(["speaking", "roleplay", "conversation-prompt", "recorded-monologue"]);

export function collectCourseValidationErrors(catalog) {
  const errors = [];
  if (!isObject(catalog)) return ["catalog: expected an object"];

  validateObject(catalog.meta, "meta", COURSE_SCHEMA.meta, errors);
  if (catalog.meta?.catalogSchemaVersion !== COURSE_SCHEMA_VERSION) {
    errors.push(
      `meta.catalogSchemaVersion: expected ${COURSE_SCHEMA_VERSION}, got ${String(catalog.meta?.catalogSchemaVersion)}`
    );
  }

  const resources = requireArray(catalog, "resources", "catalog", errors);
  const levels = requireArray(catalog, "levels", "catalog", errors);
  const modules = requireArray(catalog, "modules", "catalog", errors);
  const pronunciationTopics = requireArray(catalog, "pronunciationTopics", "catalog", errors);
  const grammarTopics = requireArray(catalog, "grammarTopics", "catalog", errors);
  const lessons = requireArray(catalog, "lessons", "catalog", errors);

  resources.forEach((resource, index) => {
    validateObject(
      resource,
      `resources[${index}]`,
      { requiredText: ["name", "type", "url", "note"] },
      errors
    );
  });
  const skillAxisIds = validateCourseRoadmap(catalog.courseRoadmap, errors);

  const levelIds = new Set();
  const moduleIds = new Set();
  const pronunciationIds = new Set();
  const grammarIds = new Set();
  const lessonIds = new Set();
  const objectiveIds = new Set();
  const vocabularyIds = new Set();
  const exerciseIds = new Set();
  const lessonCardIds = new Set();

  levels.forEach((level, index) => {
    const path = `levels[${index}]`;
    validateObject(level, path, COURSE_SCHEMA.level, errors);
    registerId(level?.id, `${path}.id`, levelIds, errors);
    validatePositiveOrder(level?.order, `${path}.order`, errors);
    validateTextArray(level?.cefrLevels, `${path}.cefrLevels`, errors, { nonEmpty: true, unique: true });
    level?.cefrLevels?.forEach((cefrLevel, cefrIndex) =>
      validateLevel(cefrLevel, `${path}.cefrLevels[${cefrIndex}]`, errors)
    );
    validateTextArray(level?.prerequisites, `${path}.prerequisites`, errors, { unique: true });
  });

  modules.forEach((module, index) => {
    const path = `modules[${index}]`;
    validateObject(module, path, COURSE_SCHEMA.module, errors);
    registerId(module?.id, `${path}.id`, moduleIds, errors);
    validatePositiveOrder(module?.order, `${path}.order`, errors);
    validateTextArray(module?.prerequisites, `${path}.prerequisites`, errors, { unique: true });
  });

  levels.forEach((level, index) => {
    validateReferenceArray(level?.prerequisites, `levels[${index}].prerequisites`, levelIds, errors, {
      selfId: level?.id
    });
  });
  modules.forEach((module, index) => {
    const path = `modules[${index}]`;
    if (hasText(module?.levelId) && !levelIds.has(module.levelId)) {
      errors.push(`${path}.levelId: unknown id "${module.levelId}"`);
    }
    validateReferenceArray(module?.prerequisites, `${path}.prerequisites`, moduleIds, errors, {
      selfId: module?.id
    });
  });
  validateAcyclic(levels, "levels", errors);
  validateAcyclic(modules, "modules", errors);
  validateUniqueOrders(levels, () => "catalog", "levels", errors);
  validateUniqueOrders(modules, (module) => module?.levelId, "modules", errors);

  pronunciationTopics.forEach((topic, index) => {
    const path = `pronunciationTopics[${index}]`;
    validateObject(topic, path, COURSE_SCHEMA.pronunciationTopic, errors);
    validateLevel(topic?.level, `${path}.level`, errors);
    registerId(topic?.id, `${path}.id`, pronunciationIds, errors);
    validateTextArray(topic?.minimalPairs, `${path}.minimalPairs`, errors, { nonEmpty: true });
    validateStructuredArray(topic?.paradigm, `${path}.paradigm`, COURSE_SCHEMA.paradigmEntry, errors, { nonEmpty: true });
    validateStructuredArray(topic?.commonMistakes, `${path}.commonMistakes`, COURSE_SCHEMA.mistakeEntry, errors, { nonEmpty: true });
    validateStructuredArray(topic?.exceptions, `${path}.exceptions`, COURSE_SCHEMA.mistakeEntry, errors, { nonEmpty: true });
  });

  grammarTopics.forEach((topic, index) => {
    const path = `grammarTopics[${index}]`;
    validateObject(topic, path, COURSE_SCHEMA.grammarTopic, errors);
    validateLevel(topic?.level, `${path}.level`, errors);
    registerId(topic?.id, `${path}.id`, grammarIds, errors);
    validateTextArray(topic?.examples, `${path}.examples`, errors, { nonEmpty: true });
    validateStructuredArray(topic?.paradigm, `${path}.paradigm`, COURSE_SCHEMA.paradigmEntry, errors, { nonEmpty: true });
    validateStructuredArray(topic?.commonMistakes, `${path}.commonMistakes`, COURSE_SCHEMA.mistakeEntry, errors, { nonEmpty: true });
    validateStructuredArray(topic?.exceptions, `${path}.exceptions`, COURSE_SCHEMA.mistakeEntry, errors, { nonEmpty: true });
  });

  lessons.forEach((lesson, lessonIndex) => {
    registerId(lesson?.id, `lessons[${lessonIndex}].id`, lessonIds, errors);
  });

  lessons.forEach((lesson, lessonIndex) => {
    const path = `lessons[${lessonIndex}]`;
    validateObject(lesson, path, COURSE_SCHEMA.lesson, errors);
    validateLevel(lesson?.level, `${path}.level`, errors);
    validatePositiveOrder(lesson?.order, `${path}.order`, errors);
    validateTextArray(lesson?.prerequisites, `${path}.prerequisites`, errors, { unique: true });
    validateReferenceArray(lesson?.prerequisites, `${path}.prerequisites`, lessonIds, errors, {
      selfId: lesson?.id
    });
    validateTextArray(lesson?.tags, `${path}.tags`, errors);

    const module = modules.find((item) => item?.id === lesson?.moduleId);
    if (hasText(lesson?.moduleId) && !moduleIds.has(lesson.moduleId)) {
      errors.push(`${path}.moduleId: unknown id "${lesson.moduleId}"`);
    } else if (module) {
      const level = levels.find((item) => item?.id === module.levelId);
      if (level && hasText(lesson?.level) && !level.cefrLevels?.includes(lesson.level)) {
        errors.push(`${path}.level: "${lesson.level}" is outside level track "${level.id}"`);
      }
    }

    if (hasText(lesson?.pronunciationTopic) && !pronunciationIds.has(lesson.pronunciationTopic)) {
      errors.push(`${path}.pronunciationTopic: unknown id "${lesson.pronunciationTopic}"`);
    }
    if (hasText(lesson?.grammarTopic) && !grammarIds.has(lesson.grammarTopic)) {
      errors.push(`${path}.grammarTopic: unknown id "${lesson.grammarTopic}"`);
    }

    const objectives = Array.isArray(lesson?.objectives) ? lesson.objectives : [];
    if (objectives.length === 0) errors.push(`${path}.objectives: expected at least one item`);
    const localObjectiveIds = new Set();
    const requiredObjectiveIds = new Set();
    const coveredObjectiveIds = new Set();
    objectives.forEach((objective, index) => {
      const objectivePath = `${path}.objectives[${index}]`;
      validateObject(objective, objectivePath, COURSE_SCHEMA.objective, errors);
      registerId(objective?.id, `${objectivePath}.id`, objectiveIds, errors, "obj:");
      registerId(objective?.id, `${objectivePath}.id`, localObjectiveIds, errors, "obj:");
      if (objective?.required === true && hasText(objective?.id)) requiredObjectiveIds.add(objective.id);
      if (hasText(objective?.skill) && !skillAxisIds.has(objective.skill)) {
        errors.push(`${objectivePath}.skill: unknown skill axis "${objective.skill}"`);
      }
    });

    const dialogue = Array.isArray(lesson?.dialogue) ? lesson.dialogue : [];
    if (dialogue.length === 0) errors.push(`${path}.dialogue: expected at least one item`);
    dialogue.forEach((line, index) => {
      validateObject(line, `${path}.dialogue[${index}]`, COURSE_SCHEMA.dialogueLine, errors);
    });

    const vocabulary = Array.isArray(lesson?.vocabulary) ? lesson.vocabulary : [];
    if (vocabulary.length === 0) errors.push(`${path}.vocabulary: expected at least one item`);
    vocabulary.forEach((item, index) => {
      const itemPath = `${path}.vocabulary[${index}]`;
      validateObject(item, itemPath, COURSE_SCHEMA.vocabularyItem, errors);
      registerId(item?.id, `${itemPath}.id`, vocabularyIds, errors, "vocab:");
    });

    const exercises = Array.isArray(lesson?.exercises) ? lesson.exercises : [];
    if (exercises.length === 0) errors.push(`${path}.exercises: expected at least one item`);
    exercises.forEach((exercise, index) => {
      const exercisePath = `${path}.exercises[${index}]`;
      validateObject(exercise, exercisePath, COURSE_SCHEMA.exercise, errors);
      registerId(exercise?.id, `${exercisePath}.id`, exerciseIds, errors);
      if (hasText(exercise?.type) && !ALLOWED_EXERCISE_TYPES.includes(exercise.type)) {
        errors.push(`${exercisePath}.type: unsupported exercise type "${exercise.type}"`);
      }
      validateTextArray(exercise?.acceptedAnswers, `${exercisePath}.acceptedAnswers`, errors);
      validateTextArray(exercise?.hints, `${exercisePath}.hints`, errors, { nonEmpty: true });
      validateTextArray(exercise?.requiredTokens, `${exercisePath}.requiredTokens`, errors);
      validateRequiredTokenGroups(exercise?.requiredTokenGroups, `${exercisePath}.requiredTokenGroups`, errors);
      if (exercise?.requiresRecording != null && typeof exercise.requiresRecording !== "boolean") {
        errors.push(`${exercisePath}.requiresRecording: expected a boolean`);
      }
      if (exercise?.minimumRecordingSeconds != null && (!Number.isInteger(exercise.minimumRecordingSeconds) || exercise.minimumRecordingSeconds < 3 || exercise.minimumRecordingSeconds > 90)) {
        errors.push(`${exercisePath}.minimumRecordingSeconds: expected an integer from 3 to 90`);
      }
      if (exercise?.requiresRecording === true && exercise?.minimumRecordingSeconds == null) {
        errors.push(`${exercisePath}.minimumRecordingSeconds: required when recording is required`);
      }
      if (ORAL_EXERCISE_TYPES.has(exercise?.type) && exercise?.requiresRecording === false) {
        errors.push(`${exercisePath}.requiresRecording: oral exercises cannot opt out of a recording`);
      }
      validateTextArray(exercise?.objectiveIds, `${exercisePath}.objectiveIds`, errors, {
        nonEmpty: true,
        unique: true
      });
      validateTextArray(exercise?.options, `${exercisePath}.options`, errors);
      validateTextArray(exercise?.rubric, `${exercisePath}.rubric`, errors);
      if (exercise?.type === "reading-comprehension" && !hasText(exercise?.sourceText)) {
        errors.push(`${exercisePath}.sourceText: reading-comprehension requires a source text`);
      }
      if (["listening-comprehension", "dictation"].includes(exercise?.type) && !hasText(exercise?.transcript)) {
        errors.push(`${exercisePath}.transcript: ${exercise.type} requires a transcript`);
      }
      if ([
        "conversation-prompt",
        "debate-roleplay",
        "guided-writing",
        "message-reply",
        "recorded-monologue",
        "mediation",
        "roleplay",
        "rubric-writing",
        "summarize-for-a-friend"
      ].includes(exercise?.type)) {
        if (!Array.isArray(exercise.rubric) || exercise.rubric.length === 0) {
          errors.push(`${exercisePath}.rubric: ${exercise.type} requires review criteria`);
        }
      }
      validateReferenceArray(exercise?.objectiveIds, `${exercisePath}.objectiveIds`, localObjectiveIds, errors);
      if (exercise?.required !== false) {
        exercise?.objectiveIds?.forEach((objectiveId) => coveredObjectiveIds.add(objectiveId));
      }
    });

    requiredObjectiveIds.forEach((objectiveId) => {
      if (!coveredObjectiveIds.has(objectiveId)) {
        errors.push(`${path}.objectives: required objective "${objectiveId}" is not covered by an exercise`);
      }
    });

    const cards = Array.isArray(lesson?.cards) ? lesson.cards : [];
    if (cards.length === 0) errors.push(`${path}.cards: expected at least one item`);
    cards.forEach((card, index) => {
      const cardPath = `${path}.cards[${index}]`;
      validateObject(card, cardPath, COURSE_SCHEMA.lessonCard, errors);
      registerId(card?.id, `${cardPath}.id`, lessonCardIds, errors, "phrase:");
    });
  });

  validateAcyclic(lessons, "lessons", errors);
  validateUniqueOrders(lessons, (lesson) => lesson?.moduleId, "lessons", errors);

  modules.forEach((module, index) => {
    if (hasText(module?.id) && !lessons.some((lesson) => lesson?.moduleId === module.id)) {
      errors.push(`modules[${index}]: module "${module.id}" has no lessons`);
    }
  });
  levels.forEach((level, index) => {
    if (hasText(level?.id) && !modules.some((module) => module?.levelId === level.id)) {
      errors.push(`levels[${index}]: level "${level.id}" has no modules`);
    }
  });

  return errors;
}

function validateRequiredTokenGroups(value, path, errors) {
  if (value == null) return;
  if (!Array.isArray(value)) {
    errors.push(`${path}: expected an array`);
    return;
  }
  value.forEach((group, index) => {
    const groupPath = `${path}[${index}]`;
    if (!isObject(group) || !hasText(group.label)) errors.push(`${groupPath}.label: expected text`);
    validateTextArray(group?.anyOf, `${groupPath}.anyOf`, errors, { nonEmpty: true, unique: true });
  });
}

export function validateCourseCatalog(catalog) {
  const errors = collectCourseValidationErrors(catalog);
  if (errors.length) {
    const error = new Error(`Invalid course catalog:\n- ${errors.join("\n- ")}`);
    error.validationErrors = errors;
    throw error;
  }
  return true;
}

function validateCourseRoadmap(roadmap, errors) {
  const skillAxisIds = new Set();
  if (roadmap === undefined) return skillAxisIds;
  validateObject(roadmap, "courseRoadmap", COURSE_SCHEMA.courseRoadmap, errors);

  const sources = Array.isArray(roadmap?.sources) ? roadmap.sources : [];
  sources.forEach((source, index) => {
    const path = `courseRoadmap.sources[${index}]`;
    validateObject(source, path, COURSE_SCHEMA.roadmapSource, errors);
    validateHttpUrl(source?.url, `${path}.url`, errors);
  });
  const skillAxes = Array.isArray(roadmap?.skillAxes) ? roadmap.skillAxes : [];
  skillAxes.forEach((axis, index) => {
    const path = `courseRoadmap.skillAxes[${index}]`;
    validateObject(axis, path, COURSE_SCHEMA.roadmapSkillAxis, errors);
    registerId(axis?.id, `${path}.id`, skillAxisIds, errors);
    validateTextArray(axis?.evidenceTypes, `${path}.evidenceTypes`, errors, {
      nonEmpty: true,
      unique: true
    });
  });

  const roadmapIds = new Set();
  const cefrLevels = new Set();
  const levels = Array.isArray(roadmap?.levels) ? roadmap.levels : [];
  levels.forEach((level, levelIndex) => {
    const path = `courseRoadmap.levels[${levelIndex}]`;
    validateObject(level, path, COURSE_SCHEMA.roadmapLevel, errors);
    registerId(level?.id, `${path}.id`, roadmapIds, errors, "roadmap:");
    validateLevel(level?.cefrLevel, `${path}.cefrLevel`, errors);
    if (hasText(level?.cefrLevel)) {
      if (cefrLevels.has(level.cefrLevel)) errors.push(`${path}.cefrLevel: duplicate roadmap level "${level.cefrLevel}"`);
      cefrLevels.add(level.cefrLevel);
    }
    if (hasText(level?.status) && !ROADMAP_LEVEL_STATUSES.includes(level.status)) {
      errors.push(`${path}.status: unsupported status "${level.status}"`);
    }
    validateTextArray(level?.prerequisites, `${path}.prerequisites`, errors, { unique: true });
    validateTextArray(level?.targetOutcomes, `${path}.targetOutcomes`, errors, { nonEmpty: true });

    const evidenceSkills = new Set();
    const exitEvidence = Array.isArray(level?.exitEvidence) ? level.exitEvidence : [];
    exitEvidence.forEach((evidence, evidenceIndex) => {
      const evidencePath = `${path}.exitEvidence[${evidenceIndex}]`;
      validateObject(evidence, evidencePath, COURSE_SCHEMA.roadmapExitEvidence, errors);
      if (hasText(evidence?.skill)) {
        if (!skillAxisIds.has(evidence.skill)) errors.push(`${evidencePath}.skill: unknown skill axis "${evidence.skill}"`);
        if (evidenceSkills.has(evidence.skill)) errors.push(`${evidencePath}.skill: duplicate evidence for "${evidence.skill}"`);
        evidenceSkills.add(evidence.skill);
      }
    });
    skillAxisIds.forEach((axisId) => {
      if (!evidenceSkills.has(axisId)) errors.push(`${path}.exitEvidence: missing evidence for skill axis "${axisId}"`);
    });

    const modules = Array.isArray(level?.modules) ? level.modules : [];
    modules.forEach((module, moduleIndex) => {
      const modulePath = `${path}.modules[${moduleIndex}]`;
      validateObject(module, modulePath, COURSE_SCHEMA.roadmapModule, errors);
      registerId(module?.id, `${modulePath}.id`, roadmapIds, errors, "roadmap:");
      validateTextArray(module?.skillFocus, `${modulePath}.skillFocus`, errors, {
        nonEmpty: true,
        unique: true
      });
      module?.skillFocus?.forEach((axisId, axisIndex) => {
        if (hasText(axisId) && !skillAxisIds.has(axisId)) {
          errors.push(`${modulePath}.skillFocus[${axisIndex}]: unknown skill axis "${axisId}"`);
        }
      });
      validateTextArray(module?.outcomes, `${modulePath}.outcomes`, errors, { nonEmpty: true });
      validateTextArray(module?.grammar, `${modulePath}.grammar`, errors, { nonEmpty: true });
      validateTextArray(module?.exerciseTypes, `${modulePath}.exerciseTypes`, errors, {
        nonEmpty: true,
        unique: true
      });
      module?.exerciseTypes?.forEach((type, typeIndex) => {
        if (hasText(type) && !ALLOWED_EXERCISE_TYPES.includes(type)) {
          errors.push(`${modulePath}.exerciseTypes[${typeIndex}]: unsupported exercise type "${type}"`);
        }
      });
    });
  });

  return skillAxisIds;
}

function validateObject(value, path, schema, errors) {
  if (!isObject(value)) {
    errors.push(`${path}: expected an object`);
    return;
  }
  for (const field of schema.requiredText || []) {
    if (!hasText(value[field])) errors.push(`${path}.${field}: expected a non-empty string`);
  }
  for (const field of schema.requiredInteger || []) {
    if (!Number.isInteger(value[field])) errors.push(`${path}.${field}: expected an integer`);
  }
  for (const field of schema.requiredBoolean || []) {
    if (typeof value[field] !== "boolean") errors.push(`${path}.${field}: expected a boolean`);
  }
  for (const field of schema.requiredArrays || []) {
    if (!Array.isArray(value[field])) errors.push(`${path}.${field}: expected an array`);
  }
}

function requireArray(object, field, path, errors) {
  if (!Array.isArray(object[field])) {
    errors.push(`${path}.${field}: expected an array`);
    return [];
  }
  return object[field];
}

function validateLevel(level, path, errors) {
  if (hasText(level) && !ALLOWED_LEVELS.includes(level)) {
    errors.push(`${path}: unsupported level "${level}"`);
  }
}

function validateHttpUrl(value, path, errors) {
  if (!hasText(value)) return;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) errors.push(`${path}: expected http(s) URL`);
  } catch {
    errors.push(`${path}: invalid URL`);
  }
}

function registerId(id, path, seen, errors, requiredPrefix = "") {
  if (!hasText(id)) return;
  if (!ID_PATTERN.test(id)) errors.push(`${path}: invalid id "${id}"`);
  if (requiredPrefix && !id.startsWith(requiredPrefix)) {
    errors.push(`${path}: expected prefix "${requiredPrefix}"`);
  }
  if (seen.has(id)) errors.push(`${path}: duplicate id "${id}"`);
  seen.add(id);
}

function validateTextArray(value, path, errors, { nonEmpty = false, unique = false } = {}) {
  if (!Array.isArray(value)) return;
  if (nonEmpty && value.length === 0) errors.push(`${path}: expected at least one item`);
  const seen = new Set();
  value.forEach((item, index) => {
    if (!hasText(item)) errors.push(`${path}[${index}]: expected a non-empty string`);
    if (unique && seen.has(item)) errors.push(`${path}[${index}]: duplicate reference "${item}"`);
    seen.add(item);
  });
}

function validateStructuredArray(value, path, itemSchema, errors, { nonEmpty = false } = {}) {
  if (!Array.isArray(value)) return;
  if (nonEmpty && value.length === 0) errors.push(`${path}: expected at least one item`);
  value.forEach((item, index) => {
    validateObject(item, `${path}[${index}]`, itemSchema, errors);
  });
}

function validateReferenceArray(value, path, knownIds, errors, { selfId } = {}) {
  if (!Array.isArray(value)) return;
  value.forEach((id, index) => {
    if (!hasText(id)) return;
    if (id === selfId) errors.push(`${path}[${index}]: self prerequisite "${id}"`);
    else if (!knownIds.has(id)) errors.push(`${path}[${index}]: unknown id "${id}"`);
  });
}

function validatePositiveOrder(value, path, errors) {
  if (Number.isInteger(value) && value < 1) errors.push(`${path}: expected a positive integer`);
}

function validateUniqueOrders(items, groupBy, label, errors) {
  const groups = new Map();
  items.forEach((item, index) => {
    if (!Number.isInteger(item?.order)) return;
    const group = groupBy(item) || "unknown";
    if (!groups.has(group)) groups.set(group, new Map());
    const orders = groups.get(group);
    if (orders.has(item.order)) {
      errors.push(`${label}[${index}].order: duplicate order ${item.order} in "${group}"`);
    } else {
      orders.set(item.order, index);
    }
  });
}

function validateAcyclic(items, label, errors) {
  const byId = new Map(items.filter((item) => hasText(item?.id)).map((item) => [item.id, item]));
  const state = new Map();
  const reported = new Set();

  function visit(id, trail) {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      const cycleStart = trail.indexOf(id);
      const cycle = [...trail.slice(cycleStart), id];
      const signature = [...new Set(cycle)].sort().join("|");
      if (!reported.has(signature)) {
        reported.add(signature);
        errors.push(`${label}: prerequisite cycle ${cycle.join(" -> ")}`);
      }
      return;
    }

    state.set(id, 1);
    const item = byId.get(id);
    for (const prerequisite of item?.prerequisites || []) {
      if (byId.has(prerequisite)) visit(prerequisite, [...trail, id]);
    }
    state.set(id, 2);
  }

  byId.forEach((_, id) => visit(id, []));
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
