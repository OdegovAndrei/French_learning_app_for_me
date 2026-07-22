function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function suffix(id) {
  return String(id || "").split(":").at(-1);
}

export function collectA2ValidationErrors(course, matrix) {
  const errors = [];
  if (!course || typeof course !== "object") return ["course: expected an object"];
  if (!matrix || typeof matrix !== "object") return ["matrix: expected an object"];
  if (!matrix.meta || typeof matrix.meta !== "object") errors.push("matrix.meta: expected an object");
  if (!hasText(matrix.meta?.title)) errors.push("matrix.meta.title: expected text");
  if (!hasText(matrix.meta?.contentVersion)) errors.push("matrix.meta.contentVersion: expected text");
  if (matrix.meta?.contentVersion !== course.meta?.contentVersion) {
    errors.push(`matrix.meta.contentVersion: expected ${String(course.meta?.contentVersion)}, got ${String(matrix.meta?.contentVersion)}`);
  }

  const phases = Array.isArray(matrix.phases) ? matrix.phases : [];
  if (!phases.length) errors.push("matrix.phases: expected at least one phase");
  const blocks = phases.flatMap((phase, phaseIndex) => {
    if (!hasText(phase?.id)) errors.push(`matrix.phases[${phaseIndex}].id: expected text`);
    if (!hasText(phase?.title)) errors.push(`matrix.phases[${phaseIndex}].title: expected text`);
    if (!Array.isArray(phase?.blocks)) {
      errors.push(`matrix.phases[${phaseIndex}].blocks: expected an array`);
      return [];
    }
    return phase.blocks;
  });
  const blockIds = new Set();
  for (const [index, block] of blocks.entries()) {
    const path = `matrix.blocks[${index}]`;
    if (!hasText(block?.id)) errors.push(`${path}.id: expected text`);
    if (blockIds.has(block?.id)) errors.push(`${path}.id: duplicate block "${block.id}"`);
    blockIds.add(block?.id);
    if (block?.status !== "published") errors.push(`${path}.status: expected published`);
    if (!Number.isInteger(block?.lessonCount) || block.lessonCount < 1) errors.push(`${path}.lessonCount: expected a positive integer`);
    for (const field of ["canDo", "language"]) {
      if (!Array.isArray(block?.[field]) || !block[field].length) errors.push(`${path}.${field}: expected a non-empty array`);
    }
    for (const field of ["input", "output"]) {
      if (!hasText(block?.[field])) errors.push(`${path}.${field}: expected text`);
    }
  }

  const courseModules = new Map((course.modules || []).map((module) => [suffix(module.id), module]));
  const roadmap = course.courseRoadmap?.levels?.find((level) => level.cefrLevel === "A2");
  const roadmapModules = new Map((roadmap?.modules || []).map((module) => [suffix(module.id), module]));
  const lessonGroups = new Map();
  for (const lesson of course.lessons || []) {
    const key = suffix(lesson.moduleId);
    if (!lessonGroups.has(key)) lessonGroups.set(key, []);
    lessonGroups.get(key).push(lesson);
  }

  for (const block of blocks) {
    const module = courseModules.get(block.id);
    const roadmapModule = roadmapModules.get(block.id);
    const lessons = lessonGroups.get(block.id) || [];
    if (!module) errors.push(`matrix block "${block.id}": no matching course module`);
    if (!roadmapModule) errors.push(`matrix block "${block.id}": no matching roadmap module`);
    if (lessons.length !== block.lessonCount) {
      errors.push(`matrix block "${block.id}": lessonCount ${block.lessonCount} does not match ${lessons.length} lessons`);
    }
    if (!roadmapModule) continue;
    const actualSkills = new Set(lessons.flatMap((lesson) => (lesson.objectives || []).map((objective) => objective.skill)));
    const actualTypes = new Set(lessons.flatMap((lesson) => (lesson.exercises || []).map((exercise) => exercise.type)));
    for (const skill of roadmapModule.skillFocus || []) {
      if (!actualSkills.has(skill)) errors.push(`roadmap module "${block.id}": claimed skill "${skill}" has no objective`);
    }
    for (const type of roadmapModule.exerciseTypes || []) {
      if (!actualTypes.has(type)) errors.push(`roadmap module "${block.id}": claimed exercise type "${type}" is absent`);
    }
  }
  for (const id of courseModules.keys()) {
    if (!blockIds.has(id)) errors.push(`course module "${id}": no matching matrix block`);
  }

  const allTypes = new Set((course.lessons || []).flatMap((lesson) => (lesson.exercises || []).map((exercise) => exercise.type)));
  for (const axis of course.courseRoadmap?.skillAxes || []) {
    if (!(axis.evidenceTypes || []).some((type) => allTypes.has(type))) {
      errors.push(`skill axis "${axis.id}": none of its evidenceTypes occur in A2`);
    }
  }
  return errors;
}

export function validateA2Contracts(course, matrix) {
  const errors = collectA2ValidationErrors(course, matrix);
  if (errors.length) {
    const error = new Error(`Invalid A2 contracts:\n- ${errors.join("\n- ")}`);
    error.validationErrors = errors;
    throw error;
  }
  return true;
}
