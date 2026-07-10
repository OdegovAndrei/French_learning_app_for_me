export const COURSE_SCHEMA_VERSION = 3;

export const ALLOWED_LEVELS = Object.freeze(["A0", "A1", "A2", "B1", "B2"]);

export const ALLOWED_EXERCISE_TYPES = Object.freeze([
  "translate",
  "speaking",
  "writing",
  "substitution",
  "reading-comprehension",
  "listening-comprehension",
  "dictation",
  "gap-fill",
  "matching",
  "order-dialogue",
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
export const ROADMAP_LEVEL_STATUSES = Object.freeze(["in-progress", "planned", "published"]);

export const COURSE_SCHEMA = Object.freeze({
  meta: Object.freeze({
    requiredText: Object.freeze(["title", "contentVersion", "dailyMinutes", "method"]),
    requiredInteger: Object.freeze(["catalogSchemaVersion"])
  }),
  level: Object.freeze({
    requiredText: Object.freeze(["id", "title", "claim"]),
    requiredInteger: Object.freeze(["order"]),
    requiredArrays: Object.freeze(["cefrLevels", "prerequisites"])
  }),
  module: Object.freeze({
    requiredText: Object.freeze(["id", "levelId", "title", "description"]),
    requiredInteger: Object.freeze(["order"]),
    requiredArrays: Object.freeze(["prerequisites"])
  }),
  courseRoadmap: Object.freeze({
    requiredText: Object.freeze(["status", "claimPolicy"]),
    requiredArrays: Object.freeze(["sources", "skillAxes", "levels"])
  }),
  roadmapSource: Object.freeze({
    requiredText: Object.freeze(["name", "url", "note"])
  }),
  roadmapSkillAxis: Object.freeze({
    requiredText: Object.freeze(["id", "title"]),
    requiredArrays: Object.freeze(["evidenceTypes"])
  }),
  roadmapLevel: Object.freeze({
    requiredText: Object.freeze(["id", "cefrLevel", "title", "status", "claim"]),
    requiredArrays: Object.freeze(["prerequisites", "targetOutcomes", "modules", "exitEvidence"])
  }),
  roadmapModule: Object.freeze({
    requiredText: Object.freeze(["id", "title"]),
    requiredArrays: Object.freeze(["skillFocus", "outcomes", "grammar", "exerciseTypes"])
  }),
  roadmapExitEvidence: Object.freeze({
    requiredText: Object.freeze(["skill", "evidence"])
  }),
  pronunciationTopic: Object.freeze({
    requiredText: Object.freeze(["id", "title", "level", "target", "cue"]),
    requiredArrays: Object.freeze(["minimalPairs", "paradigm", "commonMistakes", "exceptions"])
  }),
  grammarTopic: Object.freeze({
    requiredText: Object.freeze(["id", "title", "level", "rule"]),
    requiredArrays: Object.freeze(["examples", "paradigm", "commonMistakes", "exceptions"])
  }),
  paradigmEntry: Object.freeze({
    requiredText: Object.freeze(["label", "form"])
  }),
  mistakeEntry: Object.freeze({
    requiredText: Object.freeze(["wrong", "right", "note"])
  }),
  lesson: Object.freeze({
    requiredText: Object.freeze([
      "id",
      "level",
      "title",
      "goal",
      "scenario",
      "targetPhrase",
      "pronunciationTopic",
      "grammarTopic",
      "moduleId"
    ]),
    requiredInteger: Object.freeze(["order"]),
    requiredArrays: Object.freeze([
      "prerequisites",
      "objectives",
      "tags",
      "dialogue",
      "vocabulary",
      "exercises",
      "cards"
    ])
  }),
  objective: Object.freeze({
    requiredText: Object.freeze(["id", "skill", "cefrCanDo"]),
    requiredBoolean: Object.freeze(["required"])
  }),
  dialogueLine: Object.freeze({
    requiredText: Object.freeze(["speaker", "fr", "ipa", "ru"])
  }),
  vocabularyItem: Object.freeze({
    requiredText: Object.freeze(["id", "fr", "ipa", "ru", "note"])
  }),
  exercise: Object.freeze({
    requiredText: Object.freeze(["id", "type", "prompt", "modelAnswer", "explanation"]),
    requiredArrays: Object.freeze(["acceptedAnswers", "hints", "requiredTokens", "objectiveIds"])
  }),
  lessonCard: Object.freeze({
    requiredText: Object.freeze(["id", "front", "back", "type"])
  })
});
