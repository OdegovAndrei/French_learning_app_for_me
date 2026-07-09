export const COURSE_SCHEMA_VERSION = 2;

export const ALLOWED_LEVELS = Object.freeze(["A0", "A1", "A2", "B1", "B2"]);

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
  pronunciationTopic: Object.freeze({
    requiredText: Object.freeze(["id", "title", "level", "target", "cue"]),
    requiredArrays: Object.freeze(["minimalPairs"])
  }),
  grammarTopic: Object.freeze({
    requiredText: Object.freeze(["id", "title", "level", "rule"]),
    requiredArrays: Object.freeze(["examples"])
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
