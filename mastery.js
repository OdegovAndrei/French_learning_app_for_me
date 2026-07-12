const OPEN_EXERCISE_TYPES = new Set([
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
]);

export function evaluateLessonReadiness(lesson, attempts = [], recordingEvidence = new Set()) {
  const exercises = Array.isArray(lesson?.exercises)
    ? lesson.exercises.filter((exercise) => exercise?.required !== false)
    : [];
  const attemptsByExercise = normalizeAttempts(attempts);
  const evidence = exercises.map((exercise) => {
    const exerciseId = validId(exercise?.id) ? exercise.id : null;
    const attempt = exerciseId ? attemptsByExercise.get(exerciseId) : undefined;
    return {
      exerciseId,
      state: classifyExercise(exercise, attempt, recordingEvidence)
    };
  });

  const mastered = evidence.filter((item) => item.state === "mastered").length;
  const needsReview = evidence.filter((item) => item.state === "needs-review").length;
  const incomplete = evidence.length - mastered - needsReview;
  const objectiveEvidence = evaluateRequiredObjectives(lesson, exercises, evidence);
  const objectiveMastered = objectiveEvidence.filter((item) => item.state === "mastered").length;
  const objectiveNeedsReview = objectiveEvidence.filter((item) => item.state === "needs-review").length;
  const objectiveIncomplete = objectiveEvidence.length - objectiveMastered - objectiveNeedsReview;

  return {
    lessonId: validId(lesson?.id) ? lesson.id : null,
    total: evidence.length,
    mastered,
    needsReview,
    incomplete,
    canComplete:
      evidence.length > 0
      && mastered === evidence.length
      && objectiveMastered === objectiveEvidence.length,
    evidence,
    objectives: {
      total: objectiveEvidence.length,
      mastered: objectiveMastered,
      needsReview: objectiveNeedsReview,
      incomplete: objectiveIncomplete,
      evidence: objectiveEvidence
    }
  };
}

export function checkLessonPrerequisites(lesson, completedLessons = []) {
  const required = uniqueIds(Array.isArray(lesson?.prerequisites) ? lesson.prerequisites : []);
  const completed = new Set(uniqueIds(iterableValues(completedLessons)));
  const missing = required.filter((lessonId) => !completed.has(lessonId));
  return {
    met: missing.length === 0,
    required,
    missing
  };
}

export function areLessonPrerequisitesMet(lesson, completedLessons = []) {
  return checkLessonPrerequisites(lesson, completedLessons).met;
}

export function checkCatalogLessonPrerequisites(catalog, lesson, completedLessons = []) {
  const completed = new Set(uniqueIds(iterableValues(completedLessons)));
  const required = new Set();
  const missing = new Set();
  const reasons = [];
  let invalidGraph = false;

  const direct = uniqueIds(Array.isArray(lesson?.prerequisites) ? lesson.prerequisites : []);
  for (const lessonId of direct) {
    required.add(lessonId);
    if (!completed.has(lessonId)) {
      missing.add(lessonId);
      reasons.push(prerequisiteReason("lesson", lessonId, [lessonId]));
    }
  }

  if (!catalog || typeof catalog !== "object" || !lesson || typeof lesson !== "object") {
    return invalidPrerequisiteResult(required, missing, reasons, "catalog", "Каталог или урок повреждён.");
  }

  const modules = Array.isArray(catalog.modules) ? catalog.modules : [];
  const levels = Array.isArray(catalog.levels) ? catalog.levels : [];
  const lessons = Array.isArray(catalog.lessons) ? catalog.lessons : [];
  const modulesById = new Map(modules.filter((item) => validId(item?.id)).map((item) => [item.id, item]));
  const levelsById = new Map(levels.filter((item) => validId(item?.id)).map((item) => [item.id, item]));
  const lessonIds = new Set(lessons.filter((item) => validId(item?.id)).map((item) => item.id));
  for (const lessonId of direct) {
    if (!lessonIds.has(lessonId)) {
      invalidGraph = true;
      reasons.push(prerequisiteReason("catalog", lessonId, [], "Prerequisite-урок не найден."));
    }
  }

  const module = validId(lesson.moduleId) ? modulesById.get(lesson.moduleId) : null;
  if (!module) {
    invalidGraph = true;
    reasons.push(prerequisiteReason("catalog", lesson.moduleId || "module", [], "Модуль урока не найден."));
  } else {
    const modulePrerequisites = prerequisiteClosure(module, modulesById);
    if (modulePrerequisites.includes(module.id)) {
      invalidGraph = true;
      reasons.push(prerequisiteReason("catalog", module.id, [], "Цикл prerequisite-модулей."));
    }
    for (const moduleId of modulePrerequisites) {
      const nodeLessons = lessons.filter((item) => item?.moduleId === moduleId).map((item) => item.id).filter(validId);
      if (!modulesById.has(moduleId) || nodeLessons.length === 0) {
        invalidGraph = true;
        reasons.push(prerequisiteReason("catalog", moduleId, [], "Prerequisite-модуль не найден или не содержит уроков."));
        continue;
      }
      addNodeRequirement("module", moduleId, nodeLessons, completed, required, missing, reasons);
    }

    const level = validId(module.levelId) ? levelsById.get(module.levelId) : null;
    if (!level) {
      invalidGraph = true;
      reasons.push(prerequisiteReason("catalog", module.levelId || "level", [], "Уровень модуля не найден."));
    } else {
      const levelPrerequisites = prerequisiteClosure(level, levelsById);
      if (levelPrerequisites.includes(level.id)) {
        invalidGraph = true;
        reasons.push(prerequisiteReason("catalog", level.id, [], "Цикл prerequisite-уровней."));
      }
      for (const levelId of levelPrerequisites) {
        const levelModuleIds = new Set(
          modules.filter((item) => item?.levelId === levelId && validId(item.id)).map((item) => item.id)
        );
        const nodeLessons = lessons
          .filter((item) => levelModuleIds.has(item?.moduleId) && validId(item?.id))
          .map((item) => item.id);
        if (!levelsById.has(levelId) || levelModuleIds.size === 0 || nodeLessons.length === 0) {
          invalidGraph = true;
          reasons.push(prerequisiteReason("catalog", levelId, [], "Prerequisite-уровень не найден или не содержит уроков."));
          continue;
        }
        addNodeRequirement("level", levelId, nodeLessons, completed, required, missing, reasons);
      }
    }
  }

  return {
    met: missing.size === 0 && !invalidGraph,
    required: [...required],
    missing: [...missing],
    reasons
  };
}

export function getIntroducedLessonIds({ completedLessons = [], attempts = [], currentLessonId = null } = {}) {
  const introduced = new Set(uniqueIds(iterableValues(completedLessons)));
  for (const attempt of attemptValues(attempts)) {
    if (validId(attempt?.lessonId)) introduced.add(attempt.lessonId);
  }
  if (validId(currentLessonId)) introduced.add(currentLessonId);
  return [...introduced];
}

function classifyExercise(exercise, attempt, recordingEvidence) {
  const result = attempt?.result;
  if (!result || typeof result !== "object") return "incomplete";

  if (OPEN_EXERCISE_TYPES.has(exercise?.type)) {
    if (result.needsReview !== true || result.coverageComplete !== true) return "incomplete";
    if (requiresRecording(exercise) && !hasValidRecording(attempt, recordingEvidence, exercise)) return "incomplete";
    return attempt.selfReviewed === true ? "mastered" : "needs-review";
  }

  if (result.status === "correct") return "mastered";
  if (result.needsReview === true) return "needs-review";
  return "incomplete";
}

function requiresRecording(exercise) {
  if (exercise?.requiresRecording === false) return false;
  return ["speaking", "roleplay", "conversation-prompt", "recorded-monologue"].includes(exercise?.type);
}

function hasValidRecording(attempt, recordingEvidence, exercise) {
  const key = attempt?.recordingKey;
  if (!validId(key)) return false;
  const record = recordingEvidence instanceof Map ? recordingEvidence.get(key) : recordingEvidence instanceof Set ? recordingEvidence.has(key) ? { durationMs: Infinity } : null : null;
  return Boolean(record && Number(record.durationMs) >= Number(exercise.minimumRecordingSeconds || 5) * 1000);
}

function evaluateRequiredObjectives(lesson, exercises, evidence) {
  const evidenceByExerciseId = new Map(evidence.map((item) => [item.exerciseId, item]));
  const requiredObjectiveIds = new Set(
    (Array.isArray(lesson?.objectives) ? lesson.objectives : [])
      .filter((objective) => objective?.required === true && validId(objective.id))
      .map((objective) => objective.id)
  );

  return [...requiredObjectiveIds].map((objectiveId) => {
    const linked = exercises
      .filter((exercise) => Array.isArray(exercise?.objectiveIds) && exercise.objectiveIds.includes(objectiveId))
      .map((exercise) => evidenceByExerciseId.get(exercise.id))
      .filter(Boolean);
    const state = linked.some((item) => item.state === "mastered")
      ? "mastered"
      : linked.some((item) => item.state === "needs-review")
        ? "needs-review"
        : "incomplete";
    return {
      objectiveId,
      state,
      exerciseIds: linked.map((item) => item.exerciseId)
    };
  });
}

function prerequisiteClosure(node, nodesById) {
  const result = [];
  const visited = new Set();
  const visit = (item) => {
    for (const prerequisiteId of uniqueIds(Array.isArray(item?.prerequisites) ? item.prerequisites : [])) {
      if (visited.has(prerequisiteId)) continue;
      visited.add(prerequisiteId);
      result.push(prerequisiteId);
      const prerequisite = nodesById.get(prerequisiteId);
      if (prerequisite) visit(prerequisite);
    }
  };
  visit(node);
  return result;
}

function addNodeRequirement(type, id, lessonIds, completed, required, missing, reasons) {
  const nodeMissing = [];
  for (const lessonId of uniqueIds(lessonIds)) {
    required.add(lessonId);
    if (!completed.has(lessonId)) {
      missing.add(lessonId);
      nodeMissing.push(lessonId);
    }
  }
  if (nodeMissing.length) reasons.push(prerequisiteReason(type, id, nodeMissing));
}

function prerequisiteReason(type, id, missingLessonIds, message) {
  return { type, id, missingLessonIds, ...(message ? { message } : {}) };
}

function invalidPrerequisiteResult(required, missing, reasons, id, message) {
  reasons.push(prerequisiteReason("catalog", id, [], message));
  return { met: false, required: [...required], missing: [...missing], reasons };
}

function normalizeAttempts(attempts) {
  const normalized = new Map();
  for (const [fallbackId, attempt] of attemptEntries(attempts)) {
    if (!attempt || typeof attempt !== "object") continue;
    const exerciseId = validId(attempt.exerciseId)
      ? attempt.exerciseId
      : validId(attempt.id)
        ? attempt.id
        : validId(fallbackId)
          ? fallbackId
          : null;
    if (!exerciseId) continue;

    const existing = normalized.get(exerciseId);
    if (!existing || isAtLeastAsRecent(attempt, existing)) normalized.set(exerciseId, attempt);
  }
  return normalized;
}

function isAtLeastAsRecent(candidate, existing) {
  const candidateTime = attemptTime(candidate);
  const existingTime = attemptTime(existing);
  if (candidateTime === null || existingTime === null) return true;
  return candidateTime >= existingTime;
}

function attemptTime(attempt) {
  for (const field of ["checkedAt", "updatedAt", "createdAt"]) {
    const timestamp = Date.parse(attempt?.[field]);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return null;
}

function attemptEntries(attempts) {
  if (attempts instanceof Map) return attempts.entries();
  if (Array.isArray(attempts)) return attempts.map((attempt) => [null, attempt]);
  return [];
}

function attemptValues(attempts) {
  if (attempts instanceof Map) return attempts.values();
  return Array.isArray(attempts) ? attempts : [];
}

function iterableValues(value) {
  if (Array.isArray(value) || value instanceof Set) return value;
  return [];
}

function uniqueIds(values) {
  return [...new Set([...values].filter(validId))];
}

function validId(value) {
  return typeof value === "string" && value.trim().length > 0;
}
