# Close-out A1 Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real `a1` level (4 modules, 11 lessons `l12`-`l22`) to `data/lessons.json` on top of the existing `starter` content, fix the skill-axis id drift found in `l03`/`l09`/`l10`, close a TTS-prewarm gap, and flip `courseRoadmap.levels[0]` to `"published"` once everything validates.

**Architecture:** Pure content + two small code fixes. `app.js`/`exercises.js`/`mastery.js` already render and grade all 21 exercise types generically, so almost every task is JSON authored against the existing schema (`course-schema.js`) and checked by the existing validator (`course-validator.js`) via `tests/smoke.mjs`. No new UI code.

**Tech Stack:** Vanilla JS (ESM), `data/lessons.json` (schema v2), Python `scripts/prewarm_tts.py` + `server.py` (edge-tts), Node's built-in test runner style (`node tests/*.mjs`), Python `unittest` (`tests/test_prewarm.py`).

Reference spec: [docs/superpowers/specs/2026-07-09-close-a1-content-design.md](../specs/2026-07-09-close-a1-content-design.md)

## Global Constraints

- Level/module architecture: new `level` object `id: "a1"`, `prerequisites: ["starter"]`. Four new `module` objects: `module:a1:social-identity` (order 1), `module:a1:daily-services` (order 2, prerequisites `["module:a1:social-identity"]`), `module:a1:routines-plans` (order 3, prerequisites `["module:a1:daily-services"]`), `module:a1:everyday-life` (order 4, prerequisites `["module:a1:routines-plans"]`, bonus/non-roadmap module).
- `data/lessons.json` schema (`course-schema.js`) requires every lesson to carry: `id, level, title, goal, scenario, targetPhrase, pronunciationTopic, grammarTopic, moduleId, order, prerequisites[], objectives[], tags[], dialogue[], vocabulary[], exercises[], cards[]`.
- Id prefixes are enforced by `course-validator.js:registerId` — `objectives[].id` must start with `obj:`, `vocabulary[].id` with `vocab:`, `cards[].id` with `phrase:` (regardless of card `type`). Exercise/lesson/module/level ids have no required prefix but must match `/^[A-Za-z0-9][A-Za-z0-9:._-]*$/`.
- Every lesson in this plan follows the house pattern already used by `l01`-`l11`: **exactly 3 exercises, exactly 3 cards**. `prerequisites` chains linearly to the immediately preceding lesson id (e.g. `l13.prerequisites = ["l12"]`), matching the existing convention — `mastery.checkCatalogLessonPrerequisites` also walks module/level prerequisite closures, so this is redundant-but-consistent, not load-bearing on its own.
- Exercise validation rules (`course-validator.js`) that every new exercise must satisfy: `hints` non-empty; `objectiveIds` non-empty, unique, and must reference an objective id declared in the same lesson; `reading-comprehension` requires `sourceText`; `listening-comprehension`/`dictation` require `transcript` (and should also set `listenText` — same string — since `app.js` prefers `listenText` for the "Прослушать" button); these types require non-empty `rubric`: `conversation-prompt, debate-roleplay, guided-writing, message-reply, recorded-monologue, mediation, roleplay, rubric-writing, summarize-for-a-friend`.
- Canonical skill axis ids (from `courseRoadmap.skillAxes` in `data/lessons.json`): `listening, reading, spoken-interaction, spoken-production, written-production, mediation, language-system`. Every new `objectives[].skill` must be one of these exactly.
- New `grammarTopics` needed (id — first lesson that introduces it): `avoir` (l13), `il-y-a` (l14), `daily-routine-present` (l16), `time-expressions` (l17), `possessives` (l20), `adjective-agreement` (l21). Reused existing topics: `etre` (l12), `announcements` (l15), `articles` (l18), `fixed-phrases` (l19), `time-expressions` (l22, reused).
- No new pronunciation topics — reuse the existing 5 (`u-y, nasals, r, liaison, silent-endings`).
- **Test-guardrail update, called out explicitly (see spec discussion):** `tests/smoke.mjs:21` currently asserts `data.levels.length === 1`. The task that first introduces `level: "a1"` (Task 3) must update this assertion to `2`, in the same commit — otherwise that task's own verification step fails by design. `tests/smoke.mjs:48` and `:50-53` assert the roadmap A1 level stays `"in-progress"` and that no roadmap level is ever `"published"` — Task 14 (the wrap-up task) updates both, in the same commit as the status flip, once real content justifies it.
- Content tasks (adding lessons/grammarTopics/modules) don't follow classic red/green TDD — there is no separate "test" independent of the content itself. Instead each content step is: add the JSON, run `node tests/smoke.mjs`, confirm the expected pass/fail. Task 1 and Task 2 (code changes) use real red/green TDD.
- Commit after every task (conventional-commit-style prefixes, matching this repo's history: `feat:`, `fix:`, `docs:`).
- Run commands from the repo root: `/Users/andreylodegov/Documents/French_study`.

## File Structure

- Modify: `data/lessons.json` — every task in this plan touches it (adds `levels[]`/`modules[]`/`grammarTopics[]`/`lessons[]` entries, and Task 1 fixes 3 existing `objectives[].skill` values).
- Modify: `course-validator.js` — Task 1 adds the skill-axis cross-check for `lesson.objectives[].skill`.
- Modify: `tests/smoke.mjs` — Task 1 (new fixture test), Task 3 (`levels.length` assertion), Task 14 (roadmap status assertions).
- Modify: `scripts/prewarm_tts.py` — Task 2 extends `collect_texts()`.
- Modify: `tests/test_prewarm.py` — Task 2 adds a test case.
- Create (generated, not hand-written): `data/audio/*.mp3`, modify `data/audio/manifest.json` — Task 14, via running the prewarm script.
- Modify: `README.md` — Task 14.

---

### Task 1: Fix skill-axis id drift + add validator cross-check

**Files:**
- Modify: `course-validator.js:37` (call site), `course-validator.js:250-333` (`validateCourseRoadmap`), `course-validator.js:141-147` (lesson objectives loop)
- Modify: `data/lessons.json` (`l03`, `l09`, `l10` objective `skill` fields)
- Test: `tests/smoke.mjs`

**Interfaces:**
- Consumes: nothing from other tasks (this is the first task).
- Produces: `validateCourseRoadmap()` now returns a `Set` of canonical skill axis ids; `collectCourseValidationErrors()` rejects any `lesson.objectives[].skill` not in that set. Every later task's new lessons must use only canonical skill ids (see Global Constraints) or this check will fail their own verification step.

- [ ] **Step 1: Add the failing fixture test**

Open `tests/smoke.mjs`. Immediately after the `brokenLevelReference` block (ends at line 208, right before the `unknownModulePrerequisite` block that starts at line 210), insert:

```js
const unknownObjectiveSkillAxis = structuredClone(data);
unknownObjectiveSkillAxis.lessons[0].objectives[0].skill = "telepathy";
assert.ok(
  collectCourseValidationErrors(unknownObjectiveSkillAxis).some((error) => error.includes("unknown skill axis")),
  "Lesson objectives must reference a declared courseRoadmap skill axis"
);
```

- [ ] **Step 2: Run the suite, confirm it fails for the expected reason**

Run: `node tests/smoke.mjs`
Expected: throws an `AssertionError` at the new block — `collectCourseValidationErrors(...).some(...)` is `false` because the check doesn't exist yet (real `data` still validates fine at line 19, so execution reaches the new assertion before failing).

- [ ] **Step 3: Make `validateCourseRoadmap` return its `skillAxisIds` set**

In `course-validator.js`, change the function signature and the two return points. Current code (lines 250-267):

```js
function validateCourseRoadmap(roadmap, errors) {
  if (roadmap === undefined) return;
  validateObject(roadmap, "courseRoadmap", COURSE_SCHEMA.courseRoadmap, errors);

  const sources = Array.isArray(roadmap?.sources) ? roadmap.sources : [];
  sources.forEach((source, index) => {
    const path = `courseRoadmap.sources[${index}]`;
    validateObject(source, path, COURSE_SCHEMA.roadmapSource, errors);
    validateHttpUrl(source?.url, `${path}.url`, errors);
  });

  const skillAxisIds = new Set();
  const skillAxes = Array.isArray(roadmap?.skillAxes) ? roadmap.skillAxes : [];
```

Replace with:

```js
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
```

(This removes the old inline `const skillAxisIds = new Set();` that used to sit just before `const skillAxes = ...` — it's now declared once at the top of the function instead.)

Then at the very end of the function, the closing lines currently read (end of the `levels.forEach` block, lines 331-333):

```js
    });
  });
}
```

Replace with:

```js
    });
  });

  return skillAxisIds;
}
```

- [ ] **Step 4: Capture the return value and use it in the lesson objectives loop**

In `course-validator.js`, change line 37 from:

```js
  validateCourseRoadmap(catalog.courseRoadmap, errors);
```

to:

```js
  const skillAxisIds = validateCourseRoadmap(catalog.courseRoadmap, errors);
```

Then in the lesson objectives loop (lines 141-147), current code:

```js
    objectives.forEach((objective, index) => {
      const objectivePath = `${path}.objectives[${index}]`;
      validateObject(objective, objectivePath, COURSE_SCHEMA.objective, errors);
      registerId(objective?.id, `${objectivePath}.id`, objectiveIds, errors, "obj:");
      registerId(objective?.id, `${objectivePath}.id`, localObjectiveIds, errors, "obj:");
      if (objective?.required === true && hasText(objective?.id)) requiredObjectiveIds.add(objective.id);
    });
```

Replace with:

```js
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
```

- [ ] **Step 5: Run the suite again — expect a *different* failure**

Run: `node tests/smoke.mjs`
Expected: now throws at line 19 (`assert.equal(validateCourseCatalog(data), true)`), with an `Invalid course catalog` error mentioning `objectives[...].skill: unknown skill axis "sociolinguistic"` (or `"reading-reception"` / `"listening-reception"`) — this is expected and confirms the new check works; the real data hasn't been fixed yet.

- [ ] **Step 6: Fix the 3 drifted skill ids in `data/lessons.json`**

Find lesson `l03`, objective `obj:l03:adapt-name-question-register` — change `"skill": "sociolinguistic"` to `"skill": "spoken-interaction"`.

Find lesson `l09`, objective `obj:l09:read-simple-menu` — change `"skill": "reading-reception"` to `"skill": "reading"`.

Find lesson `l10`, objective `obj:l10:understand-hours` — change `"skill": "listening-reception"` to `"skill": "listening"`.

- [ ] **Step 7: Run the full suite — expect a clean pass**

Run: `node tests/smoke.mjs`
Expected: prints `Smoke tests passed: 11 lessons, 33 exercises, ...` and exits 0 (no assertion errors).

- [ ] **Step 8: Commit**

```bash
git add course-validator.js tests/smoke.mjs data/lessons.json
git commit -m "$(cat <<'EOF'
fix: cross-check lesson objective skill ids against courseRoadmap axes

l03/l09/l10 used non-canonical skill ids (sociolinguistic, reading-reception,
listening-reception) that course-validator.js silently accepted. Add the
missing cross-check and fix the 3 drifted values.
EOF
)"
```

---

### Task 2: Prewarm exercise listening/dictation audio

**Files:**
- Modify: `scripts/prewarm_tts.py:18-28` (`collect_texts`)
- Test: `tests/test_prewarm.py`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `prewarm_tts.collect_texts(data)` now also includes every `exercise.listenText`/`exercise.transcript` string. Task 14 (which actually runs the script over the real, fully-authored file) depends on this.

- [ ] **Step 1: Write the failing test**

Open `tests/test_prewarm.py`. In the `CollectTextsTests` class, after `test_deduplicates_repeated_text` (ends at line 44), add:

```python

    def test_collects_exercise_listen_text_and_transcript(self):
        data = {
            "lessons": [{
                "targetPhrase": "Bonjour.",
                "dialogue": [],
                "vocabulary": [],
                "exercises": [
                    {
                        "type": "listening-comprehension",
                        "listenText": "Le train part à dix heures.",
                        "transcript": "Le train part à dix heures."
                    },
                    {"type": "dictation", "transcript": "Le magasin est ouvert."}
                ]
            }],
            "pronunciationTopics": []
        }
        texts = prewarm_tts.collect_texts(data)
        self.assertEqual(
            texts,
            sorted({"Bonjour.", "Le train part à dix heures.", "Le magasin est ouvert."})
        )
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `python3 tests/test_prewarm.py`
Expected: `FAIL` on `test_collects_exercise_listen_text_and_transcript` — actual result is `["Bonjour."]`, missing the two exercise strings.

- [ ] **Step 3: Implement the fix**

In `scripts/prewarm_tts.py`, current `collect_texts` (lines 18-28):

```python
def collect_texts(data):
    texts = set()
    for lesson in data["lessons"]:
        texts.add(lesson["targetPhrase"])
        for line in lesson["dialogue"]:
            texts.add(line["fr"])
        for item in lesson["vocabulary"]:
            texts.add(item["fr"])
    for topic in data["pronunciationTopics"]:
        texts.add(topic["target"])
    return sorted(text for text in texts if text.strip())
```

Replace with:

```python
def collect_texts(data):
    texts = set()
    for lesson in data["lessons"]:
        texts.add(lesson["targetPhrase"])
        for line in lesson["dialogue"]:
            texts.add(line["fr"])
        for item in lesson["vocabulary"]:
            texts.add(item["fr"])
        for exercise in lesson.get("exercises", []):
            if exercise.get("listenText"):
                texts.add(exercise["listenText"])
            if exercise.get("transcript"):
                texts.add(exercise["transcript"])
    for topic in data["pronunciationTopics"]:
        texts.add(topic["target"])
    return sorted(text for text in texts if text.strip())
```

- [ ] **Step 4: Run it again, confirm it passes**

Run: `python3 tests/test_prewarm.py`
Expected: `Ran 4 tests in ...s` / `OK`

- [ ] **Step 5: Commit**

```bash
git add scripts/prewarm_tts.py tests/test_prewarm.py
git commit -m "$(cat <<'EOF'
fix: prewarm exercise listening/dictation audio, not just dialogue

collect_texts() indexed targetPhrase/dialogue/vocabulary but skipped
exercise.listenText/transcript, so l10's listening-comprehension and
dictation audio was never committed as static — it depended on the
live /tts fallback. New A1 lessons need this fixed before prewarming.
EOF
)"
```

---

### Task 3: Level `a1`, module `social-identity`, lesson `l12`

**Files:**
- Modify: `data/lessons.json` (`levels[]`, `modules[]`, `lessons[]`)
- Modify: `tests/smoke.mjs:21`

**Interfaces:**
- Consumes: canonical skill axis ids from Task 1; `etre` grammarTopic (existing); `nasals` pronunciationTopic (existing); prerequisite lesson `l11` (existing, last starter lesson).
- Produces: level id `a1`, module id `module:a1:social-identity`, lesson id `l12` — Task 4 (`l13`) chains `prerequisites: ["l12"]` to this.

- [ ] **Step 1: Add the `a1` level**

In `data/lessons.json`, in the top-level `levels` array, insert this object immediately after the `starter` level object:

```json
{
  "id": "a1",
  "title": "A1: устойчивые бытовые сценарии",
  "order": 2,
  "cefrLevels": ["A1"],
  "prerequisites": ["starter"],
  "claim": "Практический A1 по courseRoadmap.levels[0]: анкеты, числа, распорядок дня, планы на неделю и расширенный бытовой словарь. Не заменяет отдельную проверку по CEFR/DELF."
}
```

- [ ] **Step 2: Add the `social-identity` module**

In the top-level `modules` array, insert this object immediately after `module:starter:reception-review` (the last existing module):

```json
{
  "id": "module:a1:social-identity",
  "levelId": "a1",
  "title": "Контакт, личная информация и анкеты",
  "description": "Анкеты, национальности, языки, простой рассказ о себе.",
  "order": 1,
  "prerequisites": []
}
```

- [ ] **Step 3: Add lesson `l12`**

In the top-level `lessons` array, insert this object immediately after `l11`:

```json
{
  "id": "l12",
  "level": "A1",
  "title": "Анкета: имя, страна, язык",
  "goal": "Заполнить простую анкету и прочитать чужую анкету, чтобы найти имя, страну и язык.",
  "scenario": "form-registration",
  "targetPhrase": "Je suis russe. Je parle russe et un peu français.",
  "pronunciationTopic": "nasals",
  "grammarTopic": "etre",
  "moduleId": "module:a1:social-identity",
  "order": 1,
  "prerequisites": ["l11"],
  "tags": ["identity", "nationality", "form"],
  "objectives": [
    {
      "id": "obj:l12:fill-simple-form",
      "skill": "written-production",
      "cefrCanDo": "Может заполнить простую анкету с именем, страной и языком.",
      "required": true
    },
    {
      "id": "obj:l12:read-filled-form",
      "skill": "reading",
      "cefrCanDo": "Может найти в заполненной анкете имя, страну и язык.",
      "required": true
    }
  ],
  "dialogue": [
    {
      "speaker": "Employé",
      "fr": "Bonjour. Votre nom, s'il vous plaît ?",
      "ipa": "/bɔ̃.ʒuʁ vɔ.tʁə nɔ̃ sil vu plɛ/",
      "ru": "Здравствуйте. Ваше имя, пожалуйста?"
    },
    {
      "speaker": "Cliente",
      "fr": "Je m'appelle Anna. Je suis russe.",
      "ipa": "/ʒə ma.pɛl a.na ʒə sɥi ʁys/",
      "ru": "Меня зовут Анна. Я русская."
    },
    {
      "speaker": "Employé",
      "fr": "Quelle langue parlez-vous ?",
      "ipa": "/kɛl lɑ̃ɡ paʁ.le vu/",
      "ru": "На каком языке вы говорите?"
    },
    {
      "speaker": "Cliente",
      "fr": "Je parle russe et un peu français.",
      "ipa": "/ʒə paʁl ʁys e ɛ̃ pø fʁɑ̃.sɛ/",
      "ru": "Я говорю по-русски и немного по-французски."
    }
  ],
  "vocabulary": [
    {
      "id": "vocab:l12:0",
      "fr": "le nom",
      "ipa": "/lə nɔ̃/",
      "ru": "фамилия/имя",
      "note": "В анкетах: nom = фамилия, prénom = имя."
    },
    {
      "id": "vocab:l12:1",
      "fr": "le pays",
      "ipa": "/lə pe.i/",
      "ru": "страна",
      "note": "Финальное s в pays не читается."
    },
    {
      "id": "vocab:l12:2",
      "fr": "la langue",
      "ipa": "/la lɑ̃ɡ/",
      "ru": "язык",
      "note": "Носовой звук в конце — как в français."
    },
    {
      "id": "vocab:l12:3",
      "fr": "russe",
      "ipa": "/ʁys/",
      "ru": "русский/русская",
      "note": "Одна форма для мужского и женского рода."
    },
    {
      "id": "vocab:l12:4",
      "fr": "français / française",
      "ipa": "/fʁɑ̃.sɛ/ /fʁɑ̃.sɛz/",
      "ru": "французский/французская",
      "note": "В женском роде добавляется -e и звучит z."
    },
    {
      "id": "vocab:l12:5",
      "fr": "un peu",
      "ipa": "/ɛ̃ pø/",
      "ru": "немного",
      "note": "Полезно перед прилагательным или после глагола."
    },
    {
      "id": "vocab:l12:6",
      "fr": "parler",
      "ipa": "/paʁ.le/",
      "ru": "говорить",
      "note": "Je parle, vous parlez — регулярный -er глагол."
    }
  ],
  "exercises": [
    {
      "id": "l12-e1",
      "type": "guided-writing",
      "prompt": "Заполни анкету о себе: имя, страна, язык. Используй Je m'appelle..., Je suis..., Je parle...",
      "acceptedAnswers": [],
      "modelAnswer": "Je m'appelle Anna. Je suis russe. Je parle russe et un peu français.",
      "hints": ["Три предложения: имя, страна/национальность, язык(и)."],
      "requiredTokens": ["je m'appelle", "je suis", "je parle"],
      "objectiveIds": ["obj:l12:fill-simple-form"],
      "rubric": [
        "Есть имя (je m'appelle).",
        "Есть национальность (je suis).",
        "Есть хотя бы один язык (je parle)."
      ],
      "explanation": "Это управляемое письмо: три опоры обязательны, содержание — твоё."
    },
    {
      "id": "l12-e2",
      "type": "reading-comprehension",
      "prompt": "Прочитай заполненную анкету. Из какой страны Marco?",
      "sourceText": "Fiche d'inscription\nNom : Rossi\nPrénom : Marco\nPays : Italie\nLangue : italien et un peu français",
      "acceptedAnswers": ["Italie", "d'Italie", "Il est italien.", "Italie."],
      "modelAnswer": "Marco est d'Italie. Il est italien.",
      "hints": ["Ищи строку Pays."],
      "requiredTokens": [],
      "objectiveIds": ["obj:l12:read-filled-form"],
      "explanation": "Рецептивное задание: найти конкретное поле в анкете."
    },
    {
      "id": "l12-e3",
      "type": "gap-fill",
      "prompt": "Заполни пропуск: Quelle ___ parlez-vous ?",
      "acceptedAnswers": ["langue"],
      "modelAnswer": "Quelle langue parlez-vous ?",
      "hints": ["Слово из словаря урока, женский род."],
      "requiredTokens": [],
      "objectiveIds": ["obj:l12:fill-simple-form"],
      "explanation": "Langue — женский род, поэтому quelle, а не quel."
    }
  ],
  "cards": [
    {
      "id": "phrase:l12:0",
      "front": "Как вас зовут? (анкета)",
      "back": "Votre nom, s'il vous plaît ?",
      "type": "phrase"
    },
    {
      "id": "phrase:l12:1",
      "front": "Я говорю по-русски и немного по-французски.",
      "back": "Je parle russe et un peu français.",
      "type": "phrase"
    },
    {
      "id": "phrase:l12:2",
      "front": "Je suis {{c1::russe}}.",
      "back": "Я русская/русский.",
      "type": "cloze"
    }
  ]
}
```

- [ ] **Step 4: Update the `levels.length` guardrail test**

In `tests/smoke.mjs`, line 21 currently reads:

```js
assert.equal(data.levels.length, 1, "The current catalog must expose one honest Starter track");
```

Replace with:

```js
assert.equal(data.levels.length, 2, "The catalog must expose exactly the Starter and a1 tracks once A1 content ships");
```

- [ ] **Step 5: Run the suite, confirm it passes**

Run: `node tests/smoke.mjs`
Expected: `Smoke tests passed: 12 lessons, 36 exercises, ...` and exit 0.

- [ ] **Step 6: Commit**

```bash
git add data/lessons.json tests/smoke.mjs
git commit -m "$(cat <<'EOF'
feat: add level a1, module social-identity, lesson l12 (anketa)

First lesson of the A1 close-out: filling and reading a simple form
(name, country, language). Reuses the existing etre grammarTopic.
EOF
)"
```

---

### Task 4: Lesson `l13` + grammarTopic `avoir`

**Files:**
- Modify: `data/lessons.json` (`grammarTopics[]`, `lessons[]`)

**Interfaces:**
- Consumes: module `module:a1:social-identity` (Task 3), prerequisite lesson `l12` (Task 3).
- Produces: grammarTopic `avoir`, lesson id `l13` — Task 5 (`l14`) chains `prerequisites: ["l13"]`.

- [ ] **Step 1: Add the `avoir` grammarTopic**

In `data/lessons.json`, in the top-level `grammarTopics` array, insert this object immediately after `announcements` (the last existing entry):

```json
{
  "id": "avoir",
  "title": "Avoir: иметь",
  "level": "A1",
  "rule": "J'ai, tu as, il/elle a, nous avons, vous avez, ils/elles ont. Avoir нужен не только для обладания, но и для возраста (j'ai ... ans) и устойчивых конструкций (avoir besoin de, avoir faim).",
  "examples": ["J'ai vingt-cinq ans.", "Tu as une minute ?", "Nous avons une pause à midi."]
}
```

- [ ] **Step 2: Add lesson `l13`**

In the top-level `lessons` array, insert this object immediately after `l12`:

```json
{
  "id": "l13",
  "level": "A1",
  "title": "Коротко о себе",
  "goal": "Понять короткий рассказ о себе на слух и кратко рассказать о своём возрасте и городе.",
  "scenario": "self-intro-audio",
  "targetPhrase": "J'ai vingt-cinq ans. J'habite à Lyon.",
  "pronunciationTopic": "nasals",
  "grammarTopic": "avoir",
  "moduleId": "module:a1:social-identity",
  "order": 2,
  "prerequisites": ["l12"],
  "tags": ["numbers", "age", "listening"],
  "objectives": [
    {
      "id": "obj:l13:understand-self-intro",
      "skill": "listening",
      "cefrCanDo": "Может понять короткий медленный рассказ о себе: имя, возраст, город.",
      "required": true
    },
    {
      "id": "obj:l13:say-age-and-city",
      "skill": "spoken-production",
      "cefrCanDo": "Может кратко рассказать о себе: возраст и город, используя J'ai...ans и J'habite à...",
      "required": true
    }
  ],
  "dialogue": [
    {
      "speaker": "Léo",
      "fr": "Bonjour, je m'appelle Léo.",
      "ipa": "/bɔ̃.ʒuʁ ʒə ma.pɛl le.o/",
      "ru": "Здравствуйте, меня зовут Лео."
    },
    {
      "speaker": "Léo",
      "fr": "J'ai vingt-cinq ans.",
      "ipa": "/ʒe vɛ̃t.sɛ̃k ɑ̃/",
      "ru": "Мне двадцать пять лет."
    },
    {
      "speaker": "Léo",
      "fr": "J'habite à Lyon.",
      "ipa": "/ʒa.bit a ljɔ̃/",
      "ru": "Я живу в Лионе."
    }
  ],
  "vocabulary": [
    {"id": "vocab:l13:0", "fr": "zéro", "ipa": "/ze.ʁo/", "ru": "ноль", "note": "Начало счёта."},
    {"id": "vocab:l13:1", "fr": "un", "ipa": "/ɛ̃/", "ru": "один", "note": "Носовой звук, как в un café."},
    {"id": "vocab:l13:2", "fr": "deux", "ipa": "/dø/", "ru": "два", "note": "eu — закрытый звук, губы округлены."},
    {"id": "vocab:l13:3", "fr": "trois", "ipa": "/tʁwa/", "ru": "три", "note": "oi = /wa/."},
    {"id": "vocab:l13:4", "fr": "quatre", "ipa": "/katʁ/", "ru": "четыре", "note": "Финальное e не звучит."},
    {"id": "vocab:l13:5", "fr": "cinq", "ipa": "/sɛ̃k/", "ru": "пять", "note": "q обычно звучит, если дальше пауза."},
    {"id": "vocab:l13:6", "fr": "dix", "ipa": "/dis/", "ru": "десять", "note": "Перед паузой x звучит как s."},
    {"id": "vocab:l13:7", "fr": "vingt", "ipa": "/vɛ̃/", "ru": "двадцать", "note": "t не звучит в одиночном vingt."},
    {"id": "vocab:l13:8", "fr": "un an / des ans", "ipa": "/ɛ̃.n‿ɑ̃/", "ru": "год (возраст)", "note": "J'ai vingt ans — дословно «я имею двадцать лет»."},
    {"id": "vocab:l13:9", "fr": "j'ai ... ans", "ipa": "/ʒe ... ɑ̃/", "ru": "мне ... лет", "note": "Возраст называют через avoir, не être."},
    {"id": "vocab:l13:10", "fr": "habiter à", "ipa": "/a.bi.te a/", "ru": "жить в (городе)", "note": "À перед названием города."}
  ],
  "exercises": [
    {
      "id": "l13-e1",
      "type": "listening-comprehension",
      "prompt": "Прослушай рассказ о Лео. Сколько ему лет и где он живёт?",
      "transcript": "Bonjour, je m'appelle Léo. J'ai vingt-cinq ans. J'habite à Lyon.",
      "listenText": "Bonjour, je m'appelle Léo. J'ai vingt-cinq ans. J'habite à Lyon.",
      "acceptedAnswers": ["vingt-cinq ans, Lyon", "25 лет, Лион", "Il a vingt-cinq ans et il habite à Lyon.", "vingt-cinq ans à Lyon"],
      "modelAnswer": "Léo a vingt-cinq ans et il habite à Lyon.",
      "hints": ["Числа на слух: vingt-cinq = 20+5."],
      "requiredTokens": [],
      "objectiveIds": ["obj:l13:understand-self-intro"],
      "explanation": "Возраст и город — два факта, которые чаще всего спрашивают при первом знакомстве."
    },
    {
      "id": "l13-e2",
      "type": "gap-fill",
      "prompt": "Заполни: J'___ vingt-cinq ans.",
      "acceptedAnswers": ["ai"],
      "modelAnswer": "J'ai vingt-cinq ans.",
      "hints": ["Возраст — с avoir, а не être."],
      "requiredTokens": [],
      "objectiveIds": ["obj:l13:say-age-and-city"],
      "explanation": "J'ai (avoir) — стандартная конструкция для возраста во французском."
    },
    {
      "id": "l13-e3",
      "type": "recorded-monologue",
      "prompt": "Запиши голосом (или напиши план): имя, возраст, город.",
      "acceptedAnswers": [],
      "modelAnswer": "Je m'appelle Anna. J'ai vingt-cinq ans. J'habite à Lyon.",
      "hints": ["Три коротких предложения, как в примере."],
      "requiredTokens": ["je m'appelle", "j'ai", "ans", "j'habite à"],
      "objectiveIds": ["obj:l13:say-age-and-city"],
      "rubric": ["Есть имя.", "Есть возраст через j'ai ... ans.", "Есть город через j'habite à."],
      "explanation": "Устная мини-презентация о себе — базовый can-do A1 для spoken-production."
    }
  ],
  "cards": [
    {"id": "phrase:l13:0", "front": "Мне двадцать пять лет.", "back": "J'ai vingt-cinq ans.", "type": "phrase"},
    {"id": "phrase:l13:1", "front": "Я живу в Лионе.", "back": "J'habite à Lyon.", "type": "phrase"},
    {"id": "phrase:l13:2", "front": "J'ai {{c1::vingt-cinq}} ans.", "back": "Мне двадцать пять лет.", "type": "cloze"}
  ]
}
```

- [ ] **Step 3: Run the suite, confirm it passes**

Run: `node tests/smoke.mjs`
Expected: `Smoke tests passed: 13 lessons, 39 exercises, ...` and exit 0.

- [ ] **Step 4: Commit**

```bash
git add data/lessons.json
git commit -m "feat: add lesson l13 (self-intro: age and city) + avoir grammarTopic"
```

---

### Task 5: Module `daily-services`, lesson `l14` + grammarTopic `il-y-a`

**Files:**
- Modify: `data/lessons.json` (`modules[]`, `grammarTopics[]`, `lessons[]`)

**Interfaces:**
- Consumes: level `a1` (Task 3), prerequisite lesson `l13` (Task 4).
- Produces: module id `module:a1:daily-services`, grammarTopic `il-y-a`, lesson id `l14` — Task 6 (`l15`) chains to it.

- [ ] **Step 1: Add the `daily-services` module**

In `data/lessons.json`, in the top-level `modules` array, insert this object immediately after `module:a1:social-identity`:

```json
{
  "id": "module:a1:daily-services",
  "levelId": "a1",
  "title": "Числа, время и бытовые сервисы",
  "description": "Числа 0-100, il y a, чтение и объяснение объявлений/расписаний.",
  "order": 2,
  "prerequisites": ["module:a1:social-identity"]
}
```

- [ ] **Step 2: Add the `il-y-a` grammarTopic**

In the top-level `grammarTopics` array, insert this object immediately after `avoir`:

```json
{
  "id": "il-y-a",
  "title": "Il y a: есть, имеется",
  "level": "A1",
  "rule": "Il y a не меняется по числам и родам: одна форма для 'есть один стул' и 'есть двадцать стульев'. Отрицание — il n'y a pas de.",
  "examples": ["Il y a dix personnes.", "Il y a vingt chaises.", "Il n'y a pas de café."]
}
```

- [ ] **Step 3: Add lesson `l14`**

In the top-level `lessons` array, insert this object immediately after `l13`:

```json
{
  "id": "l14",
  "level": "A1",
  "title": "Числа и время: считаем и планируем",
  "goal": "Использовать числа 0-100 и il y a в простых бытовых расчётах и планировании.",
  "scenario": "counting-and-planning",
  "targetPhrase": "Il y a combien de personnes ? Il y a dix personnes.",
  "pronunciationTopic": "liaison",
  "grammarTopic": "il-y-a",
  "moduleId": "module:a1:daily-services",
  "order": 1,
  "prerequisites": ["l13"],
  "tags": ["numbers", "il-y-a", "planning"],
  "objectives": [
    {
      "id": "obj:l14:count-to-hundred",
      "skill": "language-system",
      "cefrCanDo": "Может использовать числа 0-100 в простых бытовых расчётах.",
      "required": true
    },
    {
      "id": "obj:l14:use-il-y-a",
      "skill": "language-system",
      "cefrCanDo": "Может использовать il y a, чтобы сказать о наличии и количестве.",
      "required": true
    }
  ],
  "dialogue": [
    {
      "speaker": "Organisateur",
      "fr": "Il y a combien de personnes pour la réunion ?",
      "ipa": "/il i a kɔ̃.bjɛ̃ də pɛʁ.sɔn puʁ la ʁe.y.njɔ̃/",
      "ru": "Сколько человек на встрече?"
    },
    {
      "speaker": "Collègue",
      "fr": "Il y a dix personnes.",
      "ipa": "/il i a di pɛʁ.sɔn/",
      "ru": "Десять человек."
    },
    {
      "speaker": "Organisateur",
      "fr": "Et il y a des chaises ?",
      "ipa": "/e il i a de ʃɛz/",
      "ru": "А стулья есть?"
    },
    {
      "speaker": "Collègue",
      "fr": "Oui, il y a vingt chaises.",
      "ipa": "/wi il i a vɛ̃ ʃɛz/",
      "ru": "Да, двадцать стульев."
    }
  ],
  "vocabulary": [
    {"id": "vocab:l14:0", "fr": "six", "ipa": "/sis/", "ru": "шесть", "note": "Перед согласной звучит /si/, перед гласной /siz/."},
    {"id": "vocab:l14:1", "fr": "sept", "ipa": "/sɛt/", "ru": "семь", "note": "Финальная t звучит, редкое исключение."},
    {"id": "vocab:l14:2", "fr": "huit", "ipa": "/ɥit/", "ru": "восемь", "note": "h немое, начинается с /ɥ/."},
    {"id": "vocab:l14:3", "fr": "neuf", "ipa": "/nœf/", "ru": "девять", "note": "Перед heures звучит как /nœv/: neuf heures."},
    {"id": "vocab:l14:4", "fr": "onze", "ipa": "/ɔ̃z/", "ru": "одиннадцать", "note": "Не делает liaison, в отличие от других чисел."},
    {"id": "vocab:l14:5", "fr": "trente", "ipa": "/tʁɑ̃t/", "ru": "тридцать", "note": "Дальше все десятки по этой модели: quarante, cinquante..."},
    {"id": "vocab:l14:6", "fr": "quarante", "ipa": "/ka.ʁɑ̃t/", "ru": "сорок", "note": "Похоже на trente по структуре."},
    {"id": "vocab:l14:7", "fr": "cinquante", "ipa": "/sɛ̃.kɑ̃t/", "ru": "пятьдесят", "note": "Носовой в начале, как в cinq."},
    {"id": "vocab:l14:8", "fr": "cent", "ipa": "/sɑ̃/", "ru": "сто", "note": "Без s в единственном числе: cent euros."},
    {"id": "vocab:l14:9", "fr": "il y a", "ipa": "/il i a/", "ru": "есть, имеется", "note": "Не меняется по числам: il y a un café / il y a dix cafés."}
  ],
  "exercises": [
    {
      "id": "l14-e1",
      "type": "gap-fill",
      "prompt": "Заполни: ___ dix personnes.",
      "acceptedAnswers": ["Il y a"],
      "modelAnswer": "Il y a dix personnes.",
      "hints": ["Стандартная формула наличия/количества."],
      "requiredTokens": [],
      "objectiveIds": ["obj:l14:use-il-y-a"],
      "explanation": "Il y a не согласуется с числом — форма всегда одна."
    },
    {
      "id": "l14-e2",
      "type": "controlled-production",
      "prompt": "Реши и назови по-французски: 20+10=? 40+9=? 50+50=?",
      "acceptedAnswers": [],
      "modelAnswer": "20+10 = trente. 40+9 = quarante-neuf. 50+50 = cent.",
      "hints": ["Складывай десятки и единицы, как в trente + un = trente et un."],
      "requiredTokens": ["trente"],
      "objectiveIds": ["obj:l14:count-to-hundred"],
      "explanation": "Составные числа — десяток плюс единица. Числа 70-99 (irregular) сюда намеренно не входят — это за пределами практического A1."
    },
    {
      "id": "l14-e3",
      "type": "dictation",
      "prompt": "Диктант: прослушай и запиши фразу полностью.",
      "transcript": "Il y a vingt chaises.",
      "listenText": "Il y a vingt chaises.",
      "acceptedAnswers": ["Il y a vingt chaises."],
      "modelAnswer": "Il y a vingt chaises.",
      "hints": ["Il y a не меняется; vingt — число."],
      "requiredTokens": [],
      "objectiveIds": ["obj:l14:use-il-y-a"],
      "explanation": "Диктант закрепляет il y a + число + существительное."
    }
  ],
  "cards": [
    {"id": "phrase:l14:0", "front": "Сколько человек?", "back": "Il y a combien de personnes ?", "type": "phrase"},
    {"id": "phrase:l14:1", "front": "Десять человек.", "back": "Il y a dix personnes.", "type": "phrase"},
    {"id": "phrase:l14:2", "front": "Il y a {{c1::vingt}} chaises.", "back": "Есть двадцать стульев.", "type": "cloze"}
  ]
}
```

- [ ] **Step 4: Run the suite, confirm it passes**

Run: `node tests/smoke.mjs`
Expected: `Smoke tests passed: 14 lessons, 42 exercises, ...` and exit 0.

- [ ] **Step 5: Commit**

```bash
git add data/lessons.json
git commit -m "feat: add module daily-services, lesson l14 (numbers + il y a)"
```

---

### Task 6: Lesson `l15` (reading + mediation)

**Files:**
- Modify: `data/lessons.json` (`lessons[]`)

**Interfaces:**
- Consumes: module `module:a1:daily-services` (Task 5), prerequisite lesson `l14` (Task 5), `announcements` grammarTopic (existing).
- Produces: lesson id `l15` — Task 7 (`l16`) chains to it.

- [ ] **Step 1: Add lesson `l15`**

In `data/lessons.json`, in the top-level `lessons` array, insert this object immediately after `l14`:

```json
{
  "id": "l15",
  "level": "A1",
  "title": "Часы работы: читаем и объясняем другу",
  "goal": "Найти несколько конкретных данных в объявлении о часах работы и объяснить их по-русски другу.",
  "scenario": "opening-hours-notice",
  "targetPhrase": "La pharmacie est ouverte tous les jours, sauf le dimanche.",
  "pronunciationTopic": "silent-endings",
  "grammarTopic": "announcements",
  "moduleId": "module:a1:daily-services",
  "order": 2,
  "prerequisites": ["l14"],
  "tags": ["reading", "mediation", "hours"],
  "objectives": [
    {
      "id": "obj:l15:read-notice-details",
      "skill": "reading",
      "cefrCanDo": "Может найти несколько конкретных данных (часы, дни) в коротком объявлении.",
      "required": true
    },
    {
      "id": "obj:l15:explain-to-friend",
      "skill": "mediation",
      "cefrCanDo": "Может по-русски объяснить другу главную практическую информацию из объявления.",
      "required": true
    }
  ],
  "dialogue": [
    {
      "speaker": "Amie",
      "fr": "Tu sais à quelle heure la pharmacie ferme ?",
      "ipa": "/ty sɛ a kɛ.lœʁ la faʁ.ma.si fɛʁm/",
      "ru": "Ты знаешь, во сколько закрывается аптека?"
    },
    {
      "speaker": "Toi",
      "fr": "Attends, je regarde. Elle ferme à dix-neuf heures.",
      "ipa": "/a.tɑ̃ ʒə ʁə.ɡaʁd ɛl fɛʁm a diz.nœ.v‿œʁ/",
      "ru": "Подожди, я смотрю. Она закрывается в девятнадцать часов."
    },
    {
      "speaker": "Amie",
      "fr": "Et le dimanche ?",
      "ipa": "/e lə di.mɑ̃ʃ/",
      "ru": "А в воскресенье?"
    },
    {
      "speaker": "Toi",
      "fr": "Fermé. Sauf le dimanche, c'est ouvert tous les jours.",
      "ipa": "/fɛʁ.me sof lə di.mɑ̃ʃ sɛ.t‿u.vɛʁ tu le ʒuʁ/",
      "ru": "Закрыто. Кроме воскресенья открыто каждый день."
    }
  ],
  "vocabulary": [
    {"id": "vocab:l15:0", "fr": "la pharmacie", "ipa": "/la faʁ.ma.si/", "ru": "аптека", "note": "Ударение на последнем слоге, как обычно во французском."},
    {"id": "vocab:l15:1", "fr": "fermer", "ipa": "/fɛʁ.me/", "ru": "закрываться/закрывать", "note": "Elle ferme — регулярный -er глагол."},
    {"id": "vocab:l15:2", "fr": "tous les jours", "ipa": "/tu le ʒuʁ/", "ru": "каждый день", "note": "S в tous перед les не звучит."},
    {"id": "vocab:l15:3", "fr": "sauf", "ipa": "/sof/", "ru": "кроме", "note": "Полезно для исключений в расписании."},
    {"id": "vocab:l15:4", "fr": "le dimanche", "ipa": "/lə di.mɑ̃ʃ/", "ru": "воскресенье", "note": "Дни недели пишутся с маленькой буквы."},
    {"id": "vocab:l15:5", "fr": "attends", "ipa": "/a.tɑ̃/", "ru": "подожди", "note": "От attendre, разговорная реплика."},
    {"id": "vocab:l15:6", "fr": "je regarde", "ipa": "/ʒə ʁə.ɡaʁd/", "ru": "я смотрю", "note": "Полезно, когда ищешь информацию вслух."},
    {"id": "vocab:l15:7", "fr": "dix-neuf heures", "ipa": "/diz.nœ.v‿œʁ/", "ru": "девятнадцать часов", "note": "Официальное время часто 24-часовое."}
  ],
  "exercises": [
    {
      "id": "l15-e1",
      "type": "reading-comprehension",
      "prompt": "Прочитай объявление аптеки. Во сколько она открывается по будням и что необычного в расписании?",
      "sourceText": "Pharmacie du Centre\nOuvert : tous les jours, 8h30 - 19h00\nSauf le dimanche : fermé\nLe samedi : fermeture à 13h00",
      "acceptedAnswers": ["8h30, закрыто по воскресеньям, в субботу закрывается в 13h00", "huit heures trente, fermé le dimanche, treize heures le samedi"],
      "modelAnswer": "Elle ouvre à huit heures trente. Elle est fermée le dimanche, et le samedi elle ferme à treize heures.",
      "hints": ["В тексте три отдельные детали: обычные часы, воскресенье, суббота."],
      "requiredTokens": [],
      "objectiveIds": ["obj:l15:read-notice-details"],
      "explanation": "Реальные объявления часто содержат исключения — их нужно вычленять отдельно от общего правила."
    },
    {
      "id": "l15-e2",
      "type": "summarize-for-a-friend",
      "prompt": "Объясни по-русски другу, который не знает французский: когда работает эта аптека?",
      "acceptedAnswers": [],
      "modelAnswer": "Аптека открыта каждый день с 8:30 до 19:00, кроме воскресенья — тогда закрыто. По субботам закрывается раньше, в час дня.",
      "hints": ["Медиация — это не перевод слово в слово, а передача сути на понятном языке."],
      "requiredTokens": ["воскресень", "суббот"],
      "objectiveIds": ["obj:l15:explain-to-friend"],
      "rubric": ["Названы обычные часы работы.", "Названо исключение (воскресенье).", "Названа особенность субботы."],
      "explanation": "Именно так выглядит mediation-evidence по roadmap: практическая информация, пересказанная для другого человека."
    },
    {
      "id": "l15-e3",
      "type": "gap-fill",
      "prompt": "Заполни: Ouvert tous les jours, ___ le dimanche.",
      "acceptedAnswers": ["sauf"],
      "modelAnswer": "Ouvert tous les jours, sauf le dimanche.",
      "hints": ["Слово для исключения из общего правила."],
      "requiredTokens": [],
      "objectiveIds": ["obj:l15:read-notice-details"],
      "explanation": "Sauf — ключевое слово, которое меняет смысл всего объявления."
    }
  ],
  "cards": [
    {"id": "phrase:l15:0", "front": "Кроме воскресенья.", "back": "Sauf le dimanche.", "type": "phrase"},
    {"id": "phrase:l15:1", "front": "Открыто каждый день.", "back": "Ouvert tous les jours.", "type": "phrase"},
    {"id": "phrase:l15:2", "front": "Ouvert tous les jours, {{c1::sauf}} le dimanche.", "back": "Открыто каждый день, кроме воскресенья.", "type": "cloze"}
  ]
}
```

- [ ] **Step 2: Run the suite, confirm it passes**

Run: `node tests/smoke.mjs`
Expected: `Smoke tests passed: 15 lessons, 45 exercises, ...` and exit 0.

- [ ] **Step 3: Commit**

```bash
git add data/lessons.json
git commit -m "feat: add lesson l15 (opening-hours notice: reading + mediation)"
```

---

### Task 7: Module `routines-plans`, lesson `l16` + grammarTopic `daily-routine-present`

**Files:**
- Modify: `data/lessons.json` (`modules[]`, `grammarTopics[]`, `lessons[]`)

**Interfaces:**
- Consumes: level `a1` (Task 3), prerequisite lesson `l15` (Task 6).
- Produces: module id `module:a1:routines-plans`, grammarTopic `daily-routine-present`, lesson id `l16` — Task 8 (`l17`) chains to it.

- [ ] **Step 1: Add the `routines-plans` module**

In `data/lessons.json`, in the top-level `modules` array, insert this object immediately after `module:a1:daily-services`:

```json
{
  "id": "module:a1:routines-plans",
  "levelId": "a1",
  "title": "Распорядок дня и планы на неделю",
  "description": "avoir, повседневные глаголы, дни недели, договорённости письмом.",
  "order": 3,
  "prerequisites": ["module:a1:daily-services"]
}
```

- [ ] **Step 2: Add the `daily-routine-present` grammarTopic**

In the top-level `grammarTopics` array, insert this object immediately after `il-y-a`:

```json
{
  "id": "daily-routine-present",
  "title": "Распорядок дня: возвратные глаголы и настоящее время",
  "level": "A1",
  "rule": "Действия распорядка дня часто возвратные: je me lève, je me couche. Местоимение me/te/se стоит перед глаголом. Обычные действия (travailler, manger, dîner) спрягаются как обычные -er глаголы.",
  "examples": ["Je me lève à sept heures.", "Je travaille le matin.", "Je me couche à onze heures."]
}
```

- [ ] **Step 3: Add lesson `l16`**

In the top-level `lessons` array, insert this object immediately after `l15`:

```json
{
  "id": "l16",
  "level": "A1",
  "title": "Мой обычный день",
  "goal": "Связно описать свой обычный день, используя возвратные глаголы в настоящем времени.",
  "scenario": "daily-routine",
  "targetPhrase": "Je me lève à sept heures et je vais travailler.",
  "pronunciationTopic": "silent-endings",
  "grammarTopic": "daily-routine-present",
  "moduleId": "module:a1:routines-plans",
  "order": 1,
  "prerequisites": ["l15"],
  "tags": ["routine", "reflexive-verbs", "daily-life"],
  "objectives": [
    {
      "id": "obj:l16:describe-routine",
      "skill": "spoken-production",
      "cefrCanDo": "Может связно описать свой обычный день тремя-четырьмя простыми фразами.",
      "required": true
    },
    {
      "id": "obj:l16:use-reflexive-present",
      "skill": "language-system",
      "cefrCanDo": "Может использовать возвратные глаголы se lever/se coucher в настоящем времени.",
      "required": true
    }
  ],
  "dialogue": [
    {
      "speaker": "Ami",
      "fr": "Tu te lèves à quelle heure ?",
      "ipa": "/ty tə lɛv a kɛ.lœʁ/",
      "ru": "Во сколько ты встаёшь?"
    },
    {
      "speaker": "Toi",
      "fr": "Je me lève à sept heures. Je travaille le matin.",
      "ipa": "/ʒə mə lɛv a sɛ.t‿œʁ ʒə tʁa.vaj lə ma.tɛ̃/",
      "ru": "Я встаю в семь. Работаю утром."
    },
    {
      "speaker": "Ami",
      "fr": "Et le soir ?",
      "ipa": "/e lə swaʁ/",
      "ru": "А вечером?"
    },
    {
      "speaker": "Toi",
      "fr": "Je dîne à huit heures et je me couche à onze heures.",
      "ipa": "/ʒə din a ɥi.t‿œʁ e ʒə mə kuʃ a ɔ̃.z‿œʁ/",
      "ru": "Ужинаю в восемь и ложусь в одиннадцать."
    }
  ],
  "vocabulary": [
    {"id": "vocab:l16:0", "fr": "se lever", "ipa": "/sə lə.ve/", "ru": "вставать", "note": "Je me lève — è открывается в спряжении."},
    {"id": "vocab:l16:1", "fr": "se coucher", "ipa": "/sə ku.ʃe/", "ru": "ложиться спать", "note": "Je me couche — обычный возвратный -er глагол."},
    {"id": "vocab:l16:2", "fr": "travailler", "ipa": "/tʁa.va.je/", "ru": "работать", "note": "Обычный -er глагол."},
    {"id": "vocab:l16:3", "fr": "dîner", "ipa": "/di.ne/", "ru": "ужинать", "note": "^ над i — просто орфография, не меняет звук."},
    {"id": "vocab:l16:4", "fr": "le matin", "ipa": "/lə ma.tɛ̃/", "ru": "утро", "note": "Le matin = утром, без предлога."},
    {"id": "vocab:l16:5", "fr": "le soir", "ipa": "/lə swaʁ/", "ru": "вечер", "note": "Le soir = вечером."},
    {"id": "vocab:l16:6", "fr": "prendre le petit-déjeuner", "ipa": "/pʁɑ̃dʁ lə pə.ti de.ʒœ.ne/", "ru": "завтракать", "note": "Дословно: брать маленький обед."},
    {"id": "vocab:l16:7", "fr": "rentrer", "ipa": "/ʁɑ̃.tʁe/", "ru": "возвращаться домой", "note": "Je rentre à la maison."}
  ],
  "exercises": [
    {
      "id": "l16-e1",
      "type": "sentence-transform",
      "prompt": "Преврати в вопрос: Tu te lèves à sept heures. → ?",
      "acceptedAnswers": [],
      "modelAnswer": "Tu te lèves à quelle heure ?",
      "hints": ["Замени время на вопросительное слово quelle heure."],
      "requiredTokens": ["te lèves", "quelle heure"],
      "objectiveIds": ["obj:l16:use-reflexive-present"],
      "explanation": "Возвратное местоимение te остаётся на месте, меняется только конец фразы."
    },
    {
      "id": "l16-e2",
      "type": "gap-fill",
      "prompt": "Заполни: Je ___ couche à onze heures.",
      "acceptedAnswers": ["me"],
      "modelAnswer": "Je me couche à onze heures.",
      "hints": ["Возвратное местоимение для je."],
      "requiredTokens": [],
      "objectiveIds": ["obj:l16:use-reflexive-present"],
      "explanation": "Me стоит перед спрягаемым глаголом couche."
    },
    {
      "id": "l16-e3",
      "type": "recorded-monologue",
      "prompt": "Запиши голосом (или напиши план): расскажи свой обычный день в 3-4 фразах.",
      "acceptedAnswers": [],
      "modelAnswer": "Je me lève à sept heures. Je travaille le matin. Je dîne à huit heures et je me couche à onze heures.",
      "hints": ["Используй порядок: подъём → день → вечер → сон."],
      "requiredTokens": ["je me lève", "je me couche"],
      "objectiveIds": ["obj:l16:describe-routine"],
      "rubric": ["Есть время подъёма.", "Есть хотя бы одно дневное действие.", "Есть время отхода ко сну."],
      "explanation": "Это ключевое spoken-production evidence модуля routines-plans."
    }
  ],
  "cards": [
    {"id": "phrase:l16:0", "front": "Я встаю в семь.", "back": "Je me lève à sept heures.", "type": "phrase"},
    {"id": "phrase:l16:1", "front": "Я ложусь спать в одиннадцать.", "back": "Je me couche à onze heures.", "type": "phrase"},
    {"id": "phrase:l16:2", "front": "Je {{c1::me lève}} à sept heures.", "back": "Я встаю в семь.", "type": "cloze"}
  ]
}
```

- [ ] **Step 4: Run the suite, confirm it passes**

Run: `node tests/smoke.mjs`
Expected: `Smoke tests passed: 16 lessons, 48 exercises, ...` and exit 0.

- [ ] **Step 5: Commit**

```bash
git add data/lessons.json
git commit -m "feat: add module routines-plans, lesson l16 (daily routine)"
```

---

### Task 8: Lesson `l17` + grammarTopic `time-expressions`

**Files:**
- Modify: `data/lessons.json` (`grammarTopics[]`, `lessons[]`)

**Interfaces:**
- Consumes: module `module:a1:routines-plans` (Task 7), prerequisite lesson `l16` (Task 7).
- Produces: grammarTopic `time-expressions`, lesson id `l17` — Task 9 (`l18`) chains to it; Task 13 (`l22`) reuses `time-expressions`.

- [ ] **Step 1: Add the `time-expressions` grammarTopic**

In `data/lessons.json`, in the top-level `grammarTopics` array, insert this object immediately after `daily-routine-present`:

```json
{
  "id": "time-expressions",
  "title": "Дни недели и время: планы",
  "level": "A1",
  "rule": "Дни недели (lundi...dimanche) идут без артикля для одного конкретного дня, но с le для повторяющегося события: le lundi = по понедельникам. Prochain/prochaine — следующий/следующая.",
  "examples": ["Lundi, je travaille.", "Le lundi, je fais du sport.", "On se voit la semaine prochaine ?"]
}
```

- [ ] **Step 2: Add lesson `l17`**

In the top-level `lessons` array, insert this object immediately after `l16`:

```json
{
  "id": "l17",
  "level": "A1",
  "title": "Дни недели и планы на неделю",
  "goal": "Предложить день недели для встречи, отреагировать на предложение и ответить письменно на сообщение о планах.",
  "scenario": "weekly-plans",
  "targetPhrase": "Tu es libre lundi prochain ?",
  "pronunciationTopic": "nasals",
  "grammarTopic": "time-expressions",
  "moduleId": "module:a1:routines-plans",
  "order": 2,
  "prerequisites": ["l16"],
  "tags": ["days", "plans", "message-reply"],
  "objectives": [
    {
      "id": "obj:l17:propose-and-confirm",
      "skill": "spoken-interaction",
      "cefrCanDo": "Может предложить день недели для встречи и отреагировать на предложение.",
      "required": true
    },
    {
      "id": "obj:l17:reply-to-message",
      "skill": "written-production",
      "cefrCanDo": "Может письменно ответить на предложение о встрече, указав день и своё согласие/уточнение.",
      "required": true
    }
  ],
  "dialogue": [
    {
      "speaker": "Sami",
      "fr": "Tu es libre lundi prochain ?",
      "ipa": "/ty ɛ libʁ lœ̃.di pʁɔ.ʃɛ̃/",
      "ru": "Ты свободен в следующий понедельник?"
    },
    {
      "speaker": "Toi",
      "fr": "Non, je suis occupé. Mais je suis libre mercredi.",
      "ipa": "/nɔ̃ ʒə sɥi.z‿ɔ.ky.pe mɛ ʒə sɥi libʁ mɛʁ.kʁə.di/",
      "ru": "Нет, я занят. Но я свободен в среду."
    },
    {
      "speaker": "Sami",
      "fr": "D'accord, mercredi soir ?",
      "ipa": "/da.kɔʁ mɛʁ.kʁə.di swaʁ/",
      "ru": "Хорошо, в среду вечером?"
    },
    {
      "speaker": "Toi",
      "fr": "Parfait, à mercredi !",
      "ipa": "/paʁ.fɛ a mɛʁ.kʁə.di/",
      "ru": "Отлично, до среды!"
    }
  ],
  "vocabulary": [
    {"id": "vocab:l17:0", "fr": "lundi", "ipa": "/lœ̃.di/", "ru": "понедельник", "note": "Дни недели с маленькой буквы."},
    {"id": "vocab:l17:1", "fr": "mardi", "ipa": "/maʁ.di/", "ru": "вторник", "note": "-di на конце — общий суффикс дней."},
    {"id": "vocab:l17:2", "fr": "mercredi", "ipa": "/mɛʁ.kʁə.di/", "ru": "среда", "note": "Самое длинное из семи слов."},
    {"id": "vocab:l17:3", "fr": "jeudi", "ipa": "/ʒø.di/", "ru": "четверг", "note": "eu — закрытый звук."},
    {"id": "vocab:l17:4", "fr": "vendredi", "ipa": "/vɑ̃.dʁə.di/", "ru": "пятница", "note": "Носовой звук в начале."},
    {"id": "vocab:l17:5", "fr": "samedi", "ipa": "/sam.di/", "ru": "суббота", "note": "Единственный день без -di как отдельного слога после согласной паузы."},
    {"id": "vocab:l17:6", "fr": "dimanche", "ipa": "/di.mɑ̃ʃ/", "ru": "воскресенье", "note": "Единственный день без окончания -di."},
    {"id": "vocab:l17:7", "fr": "libre", "ipa": "/libʁ/", "ru": "свободен/свободна", "note": "Одна форма для обоих родов."},
    {"id": "vocab:l17:8", "fr": "occupé / occupée", "ipa": "/ɔ.ky.pe/", "ru": "занят/занята", "note": "В женском роде добавляется немая -e."}
  ],
  "exercises": [
    {
      "id": "l17-e1",
      "type": "conversation-prompt",
      "prompt": "Предложи другу встретиться в четверг. Он(а) откажется и предложит пятницу — отреагируй.",
      "acceptedAnswers": [],
      "modelAnswer": "Tu es libre jeudi ? — Non, je suis occupé jeudi, mais je suis libre vendredi. — D'accord, à vendredi !",
      "hints": ["Три шага: предложение, отказ+альтернатива, согласие."],
      "requiredTokens": ["libre", "jeudi", "vendredi"],
      "objectiveIds": ["obj:l17:propose-and-confirm"],
      "rubric": ["Есть предложение дня.", "Есть отказ или уточнение.", "Есть согласие на новый день."],
      "explanation": "Устный обмен с уточнением — типичный spoken-interaction can-do A1."
    },
    {
      "id": "l17-e2",
      "type": "message-reply",
      "prompt": "Тебе написали: «On se voit samedi ou dimanche ?» Ответь письменно, выбери день и объясни коротко почему.",
      "acceptedAnswers": [],
      "modelAnswer": "Samedi, je suis occupé. Dimanche, je suis libre. On se voit dimanche ?",
      "hints": ["Не обязательно писать длинно — двух-трёх фраз достаточно."],
      "requiredTokens": ["samedi", "dimanche", "libre"],
      "objectiveIds": ["obj:l17:reply-to-message"],
      "rubric": ["Выбран конкретный день.", "Есть libre или occupé.", "Ответ понятен без дополнительных вопросов."],
      "explanation": "Message-reply — компактный формат written-production evidence."
    },
    {
      "id": "l17-e3",
      "type": "gap-fill",
      "prompt": "Заполни: Tu es libre lundi ___ ?",
      "acceptedAnswers": ["prochain"],
      "modelAnswer": "Tu es libre lundi prochain ?",
      "hints": ["Слово «следующий» для мужского рода."],
      "requiredTokens": [],
      "objectiveIds": ["obj:l17:propose-and-confirm"],
      "explanation": "Prochain/prochaine — согласуется с родом дня недели (все дни мужского рода)."
    }
  ],
  "cards": [
    {"id": "phrase:l17:0", "front": "Ты свободен в следующий понедельник?", "back": "Tu es libre lundi prochain ?", "type": "phrase"},
    {"id": "phrase:l17:1", "front": "Я занят, но свободен в среду.", "back": "Je suis occupé, mais je suis libre mercredi.", "type": "phrase"},
    {"id": "phrase:l17:2", "front": "Tu es {{c1::libre}} mercredi ?", "back": "Ты свободен в среду?", "type": "cloze"}
  ]
}
```

- [ ] **Step 3: Run the suite, confirm it passes**

Run: `node tests/smoke.mjs`
Expected: `Smoke tests passed: 17 lessons, 51 exercises, ...` and exit 0.

- [ ] **Step 4: Commit**

```bash
git add data/lessons.json
git commit -m "feat: add lesson l17 (days of the week + message-reply) + time-expressions grammarTopic"
```

---

### Task 9: Module `everyday-life`, lesson `l18`

**Files:**
- Modify: `data/lessons.json` (`modules[]`, `lessons[]`)

**Interfaces:**
- Consumes: level `a1` (Task 3), prerequisite lesson `l17` (Task 8), `articles` grammarTopic (existing).
- Produces: module id `module:a1:everyday-life`, lesson id `l18` — Task 10 (`l19`) chains to it.

- [ ] **Step 1: Add the `everyday-life` module**

In `data/lessons.json`, in the top-level `modules` array, insert this object immediately after `module:a1:routines-plans`:

```json
{
  "id": "module:a1:everyday-life",
  "levelId": "a1",
  "title": "Расширенный бытовой словарь (бонус)",
  "description": "Еда, одежда и погода, семья и дом, внешность и характер — сверх обязательного минимума roadmap:a1, для более уверенного словарного запаса. Завершается mini-bilan A1.",
  "order": 4,
  "prerequisites": ["module:a1:routines-plans"]
}
```

- [ ] **Step 2: Add lesson `l18`**

In the top-level `lessons` array, insert this object immediately after `l17`:

```json
{
  "id": "l18",
  "level": "A1",
  "title": "Еда и напитки: рынок",
  "goal": "Понять короткий список покупок и назвать нужное количество продукта на рынке.",
  "scenario": "market-shopping",
  "targetPhrase": "Je voudrais un kilo de pommes et une bouteille d'eau.",
  "pronunciationTopic": "liaison",
  "grammarTopic": "articles",
  "moduleId": "module:a1:everyday-life",
  "order": 1,
  "prerequisites": ["l17"],
  "tags": ["food", "market", "quantities"],
  "objectives": [
    {
      "id": "obj:l18:read-shopping-list",
      "skill": "reading",
      "cefrCanDo": "Может понять короткий список покупок или ценник на рынке.",
      "required": true
    },
    {
      "id": "obj:l18:ask-for-quantity",
      "skill": "language-system",
      "cefrCanDo": "Может назвать нужное количество продукта через un kilo de / une bouteille de.",
      "required": true
    }
  ],
  "dialogue": [
    {
      "speaker": "Cliente",
      "fr": "Bonjour, je voudrais un kilo de pommes.",
      "ipa": "/bɔ̃.ʒuʁ ʒə vu.dʁɛ ɛ̃ ki.lo də pɔm/",
      "ru": "Здравствуйте, я бы хотела килограмм яблок."
    },
    {
      "speaker": "Vendeur",
      "fr": "Voilà. Autre chose ?",
      "ipa": "/vwa.la otʁ ʃoz/",
      "ru": "Пожалуйста. Что-то ещё?"
    },
    {
      "speaker": "Cliente",
      "fr": "Une bouteille d'eau et du pain, s'il vous plaît.",
      "ipa": "/yn bu.tɛj do e dy pɛ̃ sil vu plɛ/",
      "ru": "Бутылку воды и хлеб, пожалуйста."
    }
  ],
  "vocabulary": [
    {"id": "vocab:l18:0", "fr": "une pomme", "ipa": "/yn pɔm/", "ru": "яблоко", "note": "Женский род, как большинство фруктов на -e."},
    {"id": "vocab:l18:1", "fr": "le pain", "ipa": "/lə pɛ̃/", "ru": "хлеб", "note": "Носовой звук, как в vin."},
    {"id": "vocab:l18:2", "fr": "l'eau", "ipa": "/lo/", "ru": "вода", "note": "Женский род: de l'eau, une bouteille d'eau."},
    {"id": "vocab:l18:3", "fr": "le fromage", "ipa": "/lə fʁɔ.maʒ/", "ru": "сыр", "note": "Частое слово для рынка/магазина."},
    {"id": "vocab:l18:4", "fr": "le lait", "ipa": "/lə lɛ/", "ru": "молоко", "note": "Финальное t не звучит."},
    {"id": "vocab:l18:5", "fr": "un kilo de", "ipa": "/ɛ̃ ki.lo də/", "ru": "килограмм (чего-то)", "note": "De не меняется на du/de la после количества."},
    {"id": "vocab:l18:6", "fr": "une bouteille de", "ipa": "/yn bu.tɛj də/", "ru": "бутылка (чего-то)", "note": "Тот же паттерн, что и kilo de."},
    {"id": "vocab:l18:7", "fr": "autre chose", "ipa": "/otʁ ʃoz/", "ru": "что-то ещё", "note": "Стандартный вопрос продавца."},
    {"id": "vocab:l18:8", "fr": "voilà", "ipa": "/vwa.la/", "ru": "вот, пожалуйста", "note": "Универсальное слово при передаче предмета."}
  ],
  "exercises": [
    {
      "id": "l18-e1",
      "type": "reading-comprehension",
      "prompt": "Прочитай список покупок. Сколько нужно хлеба и что ещё есть в списке?",
      "sourceText": "Liste de courses\nun kilo de pommes\nune bouteille d'eau\ndu pain\ndu fromage",
      "acceptedAnswers": ["du pain — без точного количества; ещё pommes, eau, fromage", "хлеб без указания количества, плюс яблоки, вода, сыр"],
      "modelAnswer": "Il y a du pain, sans quantité précise. Il y a aussi des pommes, de l'eau et du fromage.",
      "hints": ["Не у каждого товара в списке есть число — иногда просто du/de l'."],
      "requiredTokens": [],
      "objectiveIds": ["obj:l18:read-shopping-list"],
      "explanation": "Списки покупок смешивают точные количества (un kilo de) и общие (du pain)."
    },
    {
      "id": "l18-e2",
      "type": "gap-fill",
      "prompt": "Заполни: Je voudrais un kilo ___ pommes.",
      "acceptedAnswers": ["de"],
      "modelAnswer": "Je voudrais un kilo de pommes.",
      "hints": ["После выражения количества всегда de, без артикля."],
      "requiredTokens": [],
      "objectiveIds": ["obj:l18:ask-for-quantity"],
      "explanation": "Un kilo de, une bouteille de, un peu de — количество + de, артикль исчезает."
    },
    {
      "id": "l18-e3",
      "type": "roleplay",
      "prompt": "Ролевая сцена на рынке: попроси килограмм яблок и бутылку воды.",
      "acceptedAnswers": [],
      "modelAnswer": "Bonjour, je voudrais un kilo de pommes et une bouteille d'eau, s'il vous plaît.",
      "hints": ["Собери обе конструкции количества в одной фразе."],
      "requiredTokens": ["un kilo de", "une bouteille de"],
      "objectiveIds": ["obj:l18:ask-for-quantity"],
      "rubric": ["Есть вежливое начало (Bonjour/je voudrais).", "Есть un kilo de + продукт.", "Есть une bouteille de + продукт."],
      "explanation": "Практика двух параллельных конструкций количества в одной естественной просьбе."
    }
  ],
  "cards": [
    {"id": "phrase:l18:0", "front": "Килограмм яблок, пожалуйста.", "back": "Un kilo de pommes, s'il vous plaît.", "type": "phrase"},
    {"id": "phrase:l18:1", "front": "Бутылка воды и хлеб.", "back": "Une bouteille d'eau et du pain.", "type": "phrase"},
    {"id": "phrase:l18:2", "front": "Je voudrais un kilo {{c1::de}} pommes.", "back": "Я бы хотел килограмм яблок.", "type": "cloze"}
  ]
}
```

- [ ] **Step 3: Run the suite, confirm it passes**

Run: `node tests/smoke.mjs`
Expected: `Smoke tests passed: 18 lessons, 54 exercises, ...` and exit 0.

- [ ] **Step 4: Commit**

```bash
git add data/lessons.json
git commit -m "feat: add module everyday-life, lesson l18 (market shopping)"
```

---

### Task 10: Lesson `l19` (weather + clothes)

**Files:**
- Modify: `data/lessons.json` (`lessons[]`)

**Interfaces:**
- Consumes: module `module:a1:everyday-life` (Task 9), prerequisite lesson `l18` (Task 9), `fixed-phrases` grammarTopic (existing).
- Produces: lesson id `l19` — Task 11 (`l20`) chains to it.

- [ ] **Step 1: Add lesson `l19`**

In `data/lessons.json`, in the top-level `lessons` array, insert this object immediately after `l18`:

```json
{
  "id": "l19",
  "level": "A1",
  "title": "Одежда и погода",
  "goal": "Понять короткий прогноз погоды на слух и сказать, какая погода и что надеть.",
  "scenario": "weather-and-clothes",
  "targetPhrase": "Il fait froid. Je mets un manteau.",
  "pronunciationTopic": "nasals",
  "grammarTopic": "fixed-phrases",
  "moduleId": "module:a1:everyday-life",
  "order": 2,
  "prerequisites": ["l18"],
  "tags": ["weather", "clothes", "listening"],
  "objectives": [
    {
      "id": "obj:l19:understand-forecast",
      "skill": "listening",
      "cefrCanDo": "Может понять короткий медленный прогноз погоды с знакомыми словами.",
      "required": true
    },
    {
      "id": "obj:l19:describe-weather-and-clothes",
      "skill": "spoken-production",
      "cefrCanDo": "Может сказать, какая погода, и что он(а) надевает.",
      "required": true
    }
  ],
  "dialogue": [
    {
      "speaker": "Météo",
      "fr": "Aujourd'hui, il fait froid et il pleut.",
      "ipa": "/o.ʒuʁ.dɥi il fɛ fʁwa e il plø/",
      "ru": "Сегодня холодно и идёт дождь."
    },
    {
      "speaker": "Météo",
      "fr": "Demain, il fait beau et il fait soleil.",
      "ipa": "/də.mɛ̃ il fɛ bo e il fɛ sɔ.lɛj/",
      "ru": "Завтра хорошая погода и солнечно."
    },
    {
      "speaker": "Toi",
      "fr": "Alors aujourd'hui, je mets un manteau.",
      "ipa": "/a.lɔʁ o.ʒuʁ.dɥi ʒə mɛ ɛ̃ mɑ̃.to/",
      "ru": "Тогда сегодня я надену пальто."
    }
  ],
  "vocabulary": [
    {"id": "vocab:l19:0", "fr": "il fait froid", "ipa": "/il fɛ fʁwa/", "ru": "холодно", "note": "Погода всегда с il fait, не être."},
    {"id": "vocab:l19:1", "fr": "il fait beau", "ipa": "/il fɛ bo/", "ru": "хорошая погода", "note": "Дословно «делает красиво»."},
    {"id": "vocab:l19:2", "fr": "il fait chaud", "ipa": "/il fɛ ʃo/", "ru": "жарко", "note": "Тот же паттерн il fait + прилагательное."},
    {"id": "vocab:l19:3", "fr": "il pleut", "ipa": "/il plø/", "ru": "идёт дождь", "note": "Особый безличный глагол pleuvoir."},
    {"id": "vocab:l19:4", "fr": "un manteau", "ipa": "/ɛ̃ mɑ̃.to/", "ru": "пальто", "note": "Множественное число manteaux."},
    {"id": "vocab:l19:5", "fr": "des chaussures", "ipa": "/de ʃo.syʁ/", "ru": "обувь", "note": "Обычно используется во множественном числе."},
    {"id": "vocab:l19:6", "fr": "un pantalon", "ipa": "/ɛ̃ pɑ̃.ta.lɔ̃/", "ru": "брюки", "note": "В единственном числе, в отличие от русского."},
    {"id": "vocab:l19:7", "fr": "une robe", "ipa": "/yn ʁɔb/", "ru": "платье", "note": "Женский род."},
    {"id": "vocab:l19:8", "fr": "mettre", "ipa": "/mɛtʁ/", "ru": "надевать", "note": "Je mets — неправильный глагол, частый в этой теме."},
    {"id": "vocab:l19:9", "fr": "le parapluie", "ipa": "/lə pa.ʁa.plɥi/", "ru": "зонт", "note": "Полезно вместе с il pleut."}
  ],
  "exercises": [
    {
      "id": "l19-e1",
      "type": "listening-comprehension",
      "prompt": "Прослушай прогноз погоды. Какая погода сегодня и завтра?",
      "transcript": "Aujourd'hui, il fait froid et il pleut. Demain, il fait beau et il fait soleil.",
      "listenText": "Aujourd'hui, il fait froid et il pleut. Demain, il fait beau et il fait soleil.",
      "acceptedAnswers": ["сегодня холодно и дождь, завтра хорошая погода и солнце", "aujourd'hui froid et pluie, demain beau et soleil"],
      "modelAnswer": "Aujourd'hui il fait froid et il pleut, demain il fait beau.",
      "hints": ["Два дня — два разных описания погоды."],
      "requiredTokens": [],
      "objectiveIds": ["obj:l19:understand-forecast"],
      "explanation": "Прогноз погоды — классический пример короткого, предсказуемого по структуре аудио для A1."
    },
    {
      "id": "l19-e2",
      "type": "speaking",
      "prompt": "Скажи: какая сегодня погода и что ты наденешь.",
      "acceptedAnswers": [],
      "modelAnswer": "Aujourd'hui il fait froid. Je mets un manteau et des chaussures.",
      "hints": ["Сначала погода через il fait/il pleut, потом je mets + одежда."],
      "requiredTokens": ["il fait", "je mets"],
      "objectiveIds": ["obj:l19:describe-weather-and-clothes"],
      "explanation": "Связка погода→одежда — естественная логика этой темы."
    },
    {
      "id": "l19-e3",
      "type": "gap-fill",
      "prompt": "Заполни: Il ___ froid, je mets un manteau.",
      "acceptedAnswers": ["fait"],
      "modelAnswer": "Il fait froid, je mets un manteau.",
      "hints": ["Погода всегда с fait, не с est."],
      "requiredTokens": [],
      "objectiveIds": ["obj:l19:describe-weather-and-clothes"],
      "explanation": "Частая ошибка новичков — сказать il est froid вместо il fait froid."
    }
  ],
  "cards": [
    {"id": "phrase:l19:0", "front": "Холодно. Я надеваю пальто.", "back": "Il fait froid. Je mets un manteau.", "type": "phrase"},
    {"id": "phrase:l19:1", "front": "Идёт дождь.", "back": "Il pleut.", "type": "phrase"},
    {"id": "phrase:l19:2", "front": "Il fait {{c1::froid}}, je mets un manteau.", "back": "Холодно, я надеваю пальто.", "type": "cloze"}
  ]
}
```

- [ ] **Step 2: Run the suite, confirm it passes**

Run: `node tests/smoke.mjs`
Expected: `Smoke tests passed: 19 lessons, 57 exercises, ...` and exit 0.

- [ ] **Step 3: Commit**

```bash
git add data/lessons.json
git commit -m "feat: add lesson l19 (weather + clothes)"
```

---

### Task 11: Lesson `l20` + grammarTopic `possessives`

**Files:**
- Modify: `data/lessons.json` (`grammarTopics[]`, `lessons[]`)

**Interfaces:**
- Consumes: module `module:a1:everyday-life` (Task 9), prerequisite lesson `l19` (Task 10).
- Produces: grammarTopic `possessives`, lesson id `l20` — Task 12 (`l21`) chains to it.

- [ ] **Step 1: Add the `possessives` grammarTopic**

In `data/lessons.json`, in the top-level `grammarTopics` array, insert this object immediately after `time-expressions`:

```json
{
  "id": "possessives",
  "title": "Притяжательные mon/ma/mes",
  "level": "A1",
  "rule": "Mon/ton/son — перед мужским родом и перед гласной у женского; ma/ta/sa — перед женским согласным; mes/tes/ses — множественное число независимо от рода.",
  "examples": ["mon père", "ma mère", "mes parents"]
}
```

- [ ] **Step 2: Add lesson `l20`**

In the top-level `lessons` array, insert this object immediately after `l19`:

```json
{
  "id": "l20",
  "level": "A1",
  "title": "Семья и дом",
  "goal": "Письменно описать свою семью и жильё, и пересказать по-русски чужое описание семьи.",
  "scenario": "family-and-home",
  "targetPhrase": "Voici ma famille : mon père, ma mère et mon frère.",
  "pronunciationTopic": "r",
  "grammarTopic": "possessives",
  "moduleId": "module:a1:everyday-life",
  "order": 3,
  "prerequisites": ["l19"],
  "tags": ["family", "home", "mediation"],
  "objectives": [
    {
      "id": "obj:l20:describe-family",
      "skill": "written-production",
      "cefrCanDo": "Может письменно описать свою семью простыми фразами с mon/ma/mes.",
      "required": true
    },
    {
      "id": "obj:l20:explain-family-to-friend",
      "skill": "mediation",
      "cefrCanDo": "Может передать другу основную информацию о чужой семье из короткого текста.",
      "required": true
    }
  ],
  "dialogue": [
    {
      "speaker": "Toi",
      "fr": "Voici une photo de ma famille.",
      "ipa": "/vwa.si yn fɔ.to də ma fa.mij/",
      "ru": "Вот фото моей семьи."
    },
    {
      "speaker": "Ami",
      "fr": "Qui est-ce ?",
      "ipa": "/ki ɛs/",
      "ru": "Кто это?"
    },
    {
      "speaker": "Toi",
      "fr": "C'est mon père, ma mère et mon frère. Nous habitons dans un appartement.",
      "ipa": "/sɛ mɔ̃ pɛʁ ma mɛʁ e mɔ̃ fʁɛʁ nu.z‿a.bi.tɔ̃ dɑ̃.z‿ɛ̃.n‿a.paʁ.tə.mɑ̃/",
      "ru": "Это мой отец, моя мать и мой брат. Мы живём в квартире."
    }
  ],
  "vocabulary": [
    {"id": "vocab:l20:0", "fr": "le père", "ipa": "/lə pɛʁ/", "ru": "отец", "note": "Финальное r звучит, e не звучит."},
    {"id": "vocab:l20:1", "fr": "la mère", "ipa": "/la mɛʁ/", "ru": "мать", "note": "Та же модель, что père."},
    {"id": "vocab:l20:2", "fr": "le frère", "ipa": "/lə fʁɛʁ/", "ru": "брат", "note": "Два r подряд — хорошая тренировка звука."},
    {"id": "vocab:l20:3", "fr": "la sœur", "ipa": "/la sœʁ/", "ru": "сестра", "note": "œu — закрытый звук, как в fleur."},
    {"id": "vocab:l20:4", "fr": "les parents", "ipa": "/le pa.ʁɑ̃/", "ru": "родители", "note": "Множественное число, t не звучит."},
    {"id": "vocab:l20:5", "fr": "les enfants", "ipa": "/le.z‿ɑ̃.fɑ̃/", "ru": "дети", "note": "Liaison между les и enfants."},
    {"id": "vocab:l20:6", "fr": "un appartement", "ipa": "/ɛ̃.n‿a.paʁ.tə.mɑ̃/", "ru": "квартира", "note": "Носовой звук в конце."},
    {"id": "vocab:l20:7", "fr": "une maison", "ipa": "/yn mɛ.zɔ̃/", "ru": "дом", "note": "S между гласными звучит как z."},
    {"id": "vocab:l20:8", "fr": "la chambre", "ipa": "/la ʃɑ̃bʁ/", "ru": "комната/спальня", "note": "Не путать с une salle (зал)."},
    {"id": "vocab:l20:9", "fr": "habiter dans", "ipa": "/a.bi.te dɑ̃/", "ru": "жить в (помещении)", "note": "Dans для помещения, à для города (сравни l13)."}
  ],
  "exercises": [
    {
      "id": "l20-e1",
      "type": "guided-writing",
      "prompt": "Опиши свою семью и жильё: кто есть в семье и где вы живёте. Используй mon/ma/mes и nous habitons.",
      "acceptedAnswers": [],
      "modelAnswer": "Voici ma famille : mon père, ma mère et ma sœur. Nous habitons dans un appartement.",
      "hints": ["Минимум два члена семьи и тип жилья."],
      "requiredTokens": ["mon", "ma", "nous habitons"],
      "objectiveIds": ["obj:l20:describe-family"],
      "rubric": ["Названы минимум два члена семьи.", "Использованы mon/ma перед ними правильно.", "Сказано, где семья живёт."],
      "explanation": "Mon/ma здесь — не грамматическое упражнение, а естественная часть описания семьи."
    },
    {
      "id": "l20-e2",
      "type": "summarize-for-a-friend",
      "prompt": "Прочитай и перескажи по-русски: «Voici la famille de Julie : son père, sa mère et son frère. Ils habitent dans une maison.» Кто в семье Жюли и где они живут?",
      "acceptedAnswers": [],
      "modelAnswer": "У Жюли есть отец, мать и брат. Они живут в доме.",
      "hints": ["Son/sa здесь значит «её», не «его» — Julie женского рода."],
      "requiredTokens": ["отец", "мать", "дом"],
      "objectiveIds": ["obj:l20:explain-family-to-friend"],
      "rubric": ["Названы все три члена семьи.", "Названо жильё (дом).", "Пересказ на русском, не дословный перевод."],
      "explanation": "Son/sa/ses согласуются с предметом обладания, а не с полом обладателя — важная деталь для правильного понимания текста."
    },
    {
      "id": "l20-e3",
      "type": "gap-fill",
      "prompt": "Заполни: Voici ___ mère. (о своей матери)",
      "acceptedAnswers": ["ma"],
      "modelAnswer": "Voici ma mère.",
      "hints": ["Mère — женский род, единственное число."],
      "requiredTokens": [],
      "objectiveIds": ["obj:l20:describe-family"],
      "explanation": "Ma перед mère — обычный случай, без перехода в mon (mère начинается с согласной)."
    }
  ],
  "cards": [
    {"id": "phrase:l20:0", "front": "Это мой отец, моя мать и мой брат.", "back": "C'est mon père, ma mère et mon frère.", "type": "phrase"},
    {"id": "phrase:l20:1", "front": "Мы живём в квартире.", "back": "Nous habitons dans un appartement.", "type": "phrase"},
    {"id": "phrase:l20:2", "front": "C'est {{c1::mon}} père.", "back": "Это мой отец.", "type": "cloze"}
  ]
}
```

- [ ] **Step 3: Run the suite, confirm it passes**

Run: `node tests/smoke.mjs`
Expected: `Smoke tests passed: 20 lessons, 60 exercises, ...` and exit 0.

- [ ] **Step 4: Commit**

```bash
git add data/lessons.json
git commit -m "feat: add lesson l20 (family + home) + possessives grammarTopic"
```

---

### Task 12: Lesson `l21` + grammarTopic `adjective-agreement`

**Files:**
- Modify: `data/lessons.json` (`grammarTopics[]`, `lessons[]`)

**Interfaces:**
- Consumes: module `module:a1:everyday-life` (Task 9), prerequisite lesson `l20` (Task 11).
- Produces: grammarTopic `adjective-agreement`, lesson id `l21` — Task 13 (`l22`) chains to it.

- [ ] **Step 1: Add the `adjective-agreement` grammarTopic**

In `data/lessons.json`, in the top-level `grammarTopics` array, insert this object immediately after `possessives`:

```json
{
  "id": "adjective-agreement",
  "title": "Согласование прилагательных",
  "level": "A1",
  "rule": "Прилагательное согласуется в роде и числе с существительным: обычно +e в женском роде, +s во множественном. Некоторые формы неправильные (beau/belle).",
  "examples": ["un petit garçon", "une petite fille", "des amis sympathiques"]
}
```

- [ ] **Step 2: Add lesson `l21`**

In the top-level `lessons` array, insert this object immediately after `l20`:

```json
{
  "id": "l21",
  "level": "A1",
  "title": "Внешность и характер",
  "goal": "Описать человека простыми прилагательными, правильно согласуя их с родом и числом.",
  "scenario": "describing-people",
  "targetPhrase": "Elle est grande et très sympathique.",
  "pronunciationTopic": "silent-endings",
  "grammarTopic": "adjective-agreement",
  "moduleId": "module:a1:everyday-life",
  "order": 4,
  "prerequisites": ["l20"],
  "tags": ["adjectives", "description", "character"],
  "objectives": [
    {
      "id": "obj:l21:describe-person",
      "skill": "spoken-interaction",
      "cefrCanDo": "Может описать человека простыми прилагательными в разговоре.",
      "required": true
    },
    {
      "id": "obj:l21:apply-agreement",
      "skill": "language-system",
      "cefrCanDo": "Может правильно согласовать прилагательное с родом и числом существительного.",
      "required": true
    }
  ],
  "dialogue": [
    {
      "speaker": "Ami",
      "fr": "Comment est ta sœur ?",
      "ipa": "/kɔ.mɑ̃.t‿ɛ ta sœʁ/",
      "ru": "Какая твоя сестра?"
    },
    {
      "speaker": "Toi",
      "fr": "Elle est grande et très sympathique.",
      "ipa": "/ɛl ɛ ɡʁɑ̃d e tʁɛ sɛ̃.pa.tik/",
      "ru": "Она высокая и очень приятная."
    },
    {
      "speaker": "Ami",
      "fr": "Et ton frère ?",
      "ipa": "/e tɔ̃ fʁɛʁ/",
      "ru": "А твой брат?"
    },
    {
      "speaker": "Toi",
      "fr": "Il est petit, mais il est très gentil.",
      "ipa": "/il ɛ pə.ti mɛ il ɛ tʁɛ ʒɑ̃.ti/",
      "ru": "Он маленький, но очень добрый."
    }
  ],
  "vocabulary": [
    {"id": "vocab:l21:0", "fr": "grand / grande", "ipa": "/ɡʁɑ̃/ /ɡʁɑ̃d/", "ru": "высокий/высокая, большой/большая", "note": "В женском роде d начинает звучать."},
    {"id": "vocab:l21:1", "fr": "petit / petite", "ipa": "/pə.ti/ /pə.tit/", "ru": "маленький/маленькая", "note": "Та же модель: немая согласная оживает в женском роде."},
    {"id": "vocab:l21:2", "fr": "sympathique", "ipa": "/sɛ̃.pa.tik/", "ru": "приятный, симпатичный", "note": "Одна форма для обоих родов — оканчивается на -e."},
    {"id": "vocab:l21:3", "fr": "gentil / gentille", "ipa": "/ʒɑ̃.ti/ /ʒɑ̃.tij/", "ru": "добрый/добрая", "note": "Женская форма звучит иначе, не только орфографически."},
    {"id": "vocab:l21:4", "fr": "content / contente", "ipa": "/kɔ̃.tɑ̃/ /kɔ̃.tɑ̃t/", "ru": "довольный/довольная", "note": "Тот же паттерн немой→звучащей согласной."},
    {"id": "vocab:l21:5", "fr": "fatigué / fatiguée", "ipa": "/fa.ti.ɡe/", "ru": "уставший/уставшая", "note": "Звучит одинаково, разница только на письме."},
    {"id": "vocab:l21:6", "fr": "jeune", "ipa": "/ʒœn/", "ru": "молодой/молодая", "note": "Одна форма для обоих родов."},
    {"id": "vocab:l21:7", "fr": "vieux / vieille", "ipa": "/vjø/ /vjɛj/", "ru": "старый/старая", "note": "Неправильная пара форм, нужно запомнить отдельно."},
    {"id": "vocab:l21:8", "fr": "beau / belle", "ipa": "/bo/ /bɛl/", "ru": "красивый/красивая", "note": "Ещё одна неправильная пара, частая в речи."},
    {"id": "vocab:l21:9", "fr": "très", "ipa": "/tʁɛ/", "ru": "очень", "note": "Усилитель перед прилагательным."}
  ],
  "exercises": [
    {
      "id": "l21-e1",
      "type": "sentence-transform",
      "prompt": "Поставь в женский род: Il est grand et gentil. → Elle est ___.",
      "acceptedAnswers": [],
      "modelAnswer": "Elle est grande et gentille.",
      "hints": ["Grand→grande (добавь d-звук), gentil→gentille (звук меняется сильнее)."],
      "requiredTokens": ["grande", "gentille"],
      "objectiveIds": ["obj:l21:apply-agreement"],
      "explanation": "Sympathique/jeune не меняются — но grand и gentil меняются заметно, это и тренируем."
    },
    {
      "id": "l21-e2",
      "type": "roleplay",
      "prompt": "Опиши другу члена своей семьи: рост и характер, минимум два прилагательных.",
      "acceptedAnswers": [],
      "modelAnswer": "Ma sœur est petite mais très sympathique.",
      "hints": ["Не забудь согласовать прилагательные с родом того, о ком говоришь."],
      "requiredTokens": [],
      "objectiveIds": ["obj:l21:describe-person"],
      "rubric": ["Названо, о ком идёт речь.", "Минимум два согласованных прилагательных.", "Есть хотя бы один усилитель (très)."],
      "explanation": "Здесь согласование проверяется не отдельно, а внутри естественной устной реплики."
    },
    {
      "id": "l21-e3",
      "type": "gap-fill",
      "prompt": "Заполни: Ma sœur est très ___. (симпатичная)",
      "acceptedAnswers": ["sympathique"],
      "modelAnswer": "Ma sœur est très sympathique.",
      "hints": ["Это прилагательное не меняется между родами."],
      "requiredTokens": [],
      "objectiveIds": ["obj:l21:apply-agreement"],
      "explanation": "Полезно явно показать: не каждое прилагательное меняет форму в женском роде."
    }
  ],
  "cards": [
    {"id": "phrase:l21:0", "front": "Она высокая и очень приятная.", "back": "Elle est grande et très sympathique.", "type": "phrase"},
    {"id": "phrase:l21:1", "front": "Он маленький, но очень добрый.", "back": "Il est petit, mais il est très gentil.", "type": "phrase"},
    {"id": "phrase:l21:2", "front": "Elle est {{c1::grande}} et sympathique.", "back": "Она высокая и приятная.", "type": "cloze"}
  ]
}
```

- [ ] **Step 3: Run the suite, confirm it passes**

Run: `node tests/smoke.mjs`
Expected: `Smoke tests passed: 21 lessons, 63 exercises, ...` and exit 0.

- [ ] **Step 4: Commit**

```bash
git add data/lessons.json
git commit -m "feat: add lesson l21 (appearance + character) + adjective-agreement grammarTopic"
```

---

### Task 13: Lesson `l22` — Mini-bilan A1 (capstone)

**Files:**
- Modify: `data/lessons.json` (`lessons[]`)

**Interfaces:**
- Consumes: module `module:a1:everyday-life` (Task 9), prerequisite lesson `l21` (Task 12), `time-expressions` grammarTopic (Task 8, reused).
- Produces: lesson id `l22`, the last lesson of the `a1` level. Task 14 depends on the full lesson set (`l12`-`l22`) existing before running the prewarm script.

- [ ] **Step 1: Add lesson `l22`**

In `data/lessons.json`, in the top-level `lessons` array, insert this object immediately after `l21` (it becomes the last element of the `lessons` array):

```json
{
  "id": "l22",
  "level": "A1",
  "title": "Mini-bilan A1",
  "goal": "Собрать распорядок дня, дни недели и место встречи в одной связной сцене — как l11 для starter.",
  "scenario": "a1-review",
  "targetPhrase": "On se voit vendredi ? J'ai une pause à midi.",
  "pronunciationTopic": "liaison",
  "grammarTopic": "time-expressions",
  "moduleId": "module:a1:everyday-life",
  "order": 5,
  "prerequisites": ["l21"],
  "tags": ["review", "mini-bilan", "a1"],
  "objectives": [
    {
      "id": "obj:l22:combine-routine-and-plans",
      "skill": "spoken-interaction",
      "cefrCanDo": "Может договориться о встрече, упомянув распорядок дня и время.",
      "required": true
    },
    {
      "id": "obj:l22:tell-a-short-story",
      "skill": "spoken-production",
      "cefrCanDo": "Может связно рассказать о типичном дне и планах на неделю, используя пройденную лексику и грамматику.",
      "required": true
    },
    {
      "id": "obj:l22:read-and-report",
      "skill": "reading",
      "cefrCanDo": "Может прочитать короткое сообщение о планах и найти в нём ключевые данные.",
      "required": true
    }
  ],
  "dialogue": [
    {
      "speaker": "Collègue",
      "fr": "On se voit vendredi ? J'ai une pause à midi.",
      "ipa": "/ɔ̃ sə vwa vɑ̃.dʁə.di ʒe yn poz a mi.di/",
      "ru": "Увидимся в пятницу? У меня перерыв в полдень."
    },
    {
      "speaker": "Toi",
      "fr": "Vendredi, je suis occupé le matin, mais libre à midi.",
      "ipa": "/vɑ̃.dʁə.di ʒə sɥi.z‿ɔ.ky.pe lə ma.tɛ̃ mɛ libʁ a mi.di/",
      "ru": "В пятницу я занят утром, но свободен в полдень."
    },
    {
      "speaker": "Collègue",
      "fr": "Parfait, à midi alors. Il y a un café près du bureau.",
      "ipa": "/paʁ.fɛ a mi.di a.lɔʁ il i a ɛ̃ ka.fe pʁɛ dy by.ʁo/",
      "ru": "Отлично, тогда в полдень. Рядом с офисом есть кафе."
    }
  ],
  "vocabulary": [
    {"id": "vocab:l22:0", "fr": "une pause", "ipa": "/yn poz/", "ru": "перерыв", "note": "J'ai une pause — снова avoir из l13/l16."},
    {"id": "vocab:l22:1", "fr": "le bureau", "ipa": "/lə by.ʁo/", "ru": "офис, кабинет", "note": "Новое слово для контекста работы."},
    {"id": "vocab:l22:2", "fr": "près de", "ipa": "/pʁɛ də/", "ru": "рядом с", "note": "Полезный предлог места."},
    {"id": "vocab:l22:3", "fr": "alors", "ipa": "/a.lɔʁ/", "ru": "тогда, значит", "note": "Частая связка в разговоре при согласовании плана."},
    {"id": "vocab:l22:4", "fr": "la semaine", "ipa": "/la sə.mɛn/", "ru": "неделя", "note": "La semaine prochaine — следующая неделя."},
    {"id": "vocab:l22:5", "fr": "d'habitude", "ipa": "/da.bi.tyd/", "ru": "обычно", "note": "Полезно перед описанием распорядка дня."}
  ],
  "exercises": [
    {
      "id": "l22-e1",
      "type": "reading-comprehension",
      "prompt": "Прочитай сообщение. Когда и где предлагают встретиться?",
      "sourceText": "Salut ! Tu es libre vendredi à midi ? Il y a un café près du bureau, sympa et pas cher. À bientôt !",
      "acceptedAnswers": ["в пятницу в полдень, в кафе рядом с офисом", "vendredi à midi, café près du bureau"],
      "modelAnswer": "Vendredi à midi, dans un café près du bureau.",
      "hints": ["Ищи день, время и место одним предложением."],
      "requiredTokens": [],
      "objectiveIds": ["obj:l22:read-and-report"],
      "explanation": "Итоговое чтение объединяет день недели (l17), время (l14) и place-словарь (l06/l22)."
    },
    {
      "id": "l22-e2",
      "type": "roleplay",
      "prompt": "Договорись о встрече на неделе: предложи день, упомяни своё расписание (работа/учёба), согласуй время и место.",
      "acceptedAnswers": [],
      "modelAnswer": "Tu es libre jeudi ? Je travaille le matin, mais je suis libre à midi. Il y a un café près du bureau.",
      "hints": ["Собери вместе: день (l17) + распорядок (l16) + место/время (l06, l14)."],
      "requiredTokens": ["libre", "je travaille"],
      "objectiveIds": ["obj:l22:combine-routine-and-plans"],
      "rubric": ["Предложен конкретный день.", "Упомянут распорядок дня (работа/учёба/пауза).", "Согласовано время и/или место встречи."],
      "explanation": "Это финальная сцена уровня A1 — она нарочно требует лексику из нескольких предыдущих уроков сразу, как l11 для starter."
    },
    {
      "id": "l22-e3",
      "type": "recorded-monologue",
      "prompt": "Расскажи связно: обычный день недели и твои планы на эту неделю (кто, когда, что делаете).",
      "acceptedAnswers": [],
      "modelAnswer": "D'habitude, je me lève à sept heures et je travaille le matin. Cette semaine, je suis libre vendredi. On se voit à midi dans un café près du bureau.",
      "hints": ["Сначала обычный день (d'habitude + present), потом конкретный план на неделю."],
      "requiredTokens": ["d'habitude", "cette semaine"],
      "objectiveIds": ["obj:l22:tell-a-short-story"],
      "rubric": ["Есть описание обычного дня.", "Есть конкретный план на неделю (день/время).", "Фразы связаны логично, а не просто перечислены."],
      "explanation": "Монолог «обычно / а на этой неделе» — стандартная итоговая can-do для routines-plans + social planning вместе."
    }
  ],
  "cards": [
    {"id": "phrase:l22:0", "front": "У меня перерыв в полдень.", "back": "J'ai une pause à midi.", "type": "phrase"},
    {"id": "phrase:l22:1", "front": "Рядом с офисом есть кафе.", "back": "Il y a un café près du bureau.", "type": "phrase"},
    {"id": "phrase:l22:2", "front": "Il y a un café {{c1::près du}} bureau.", "back": "Рядом с офисом есть кафе.", "type": "cloze"}
  ]
}
```

- [ ] **Step 2: Run the suite, confirm it passes**

Run: `node tests/smoke.mjs`
Expected: `Smoke tests passed: 22 lessons, 66 exercises, ...` and exit 0.

- [ ] **Step 3: Commit**

```bash
git add data/lessons.json
git commit -m "feat: add lesson l22 (mini-bilan A1 capstone)"
```

---

### Task 14: Prewarm audio, publish the roadmap status, update docs

**Files:**
- Modify: `data/lessons.json` (`courseRoadmap.levels[0].status`)
- Modify: `tests/smoke.mjs` (roadmap status assertions)
- Modify: `README.md`
- Create/modify (generated): `data/audio/*.mp3`, `data/audio/manifest.json`

**Interfaces:**
- Consumes: the complete `l12`-`l22` lesson set (Tasks 3-13), the extended `collect_texts()` (Task 2).
- Produces: nothing further downstream — this is the final task.

- [ ] **Step 1: Prewarm the new audio**

Run: `python3 scripts/prewarm_tts.py`
Expected: prints one `Synthesizing: ...` line per new text (dialogue lines, vocabulary, `targetPhrase`, and — thanks to Task 2 — the `listenText`/`transcript` of `l13-e1`, `l14-e3`, `l19-e1`) not already in `data/audio/manifest.json`, ending with `Prewarmed <N> phrases into .../data/audio`. Requires `pip install edge-tts` and network access; if `edge-tts` isn't installed, the script exits with `edge-tts is required to prewarm audio. Install with: pip install edge-tts` — install it first.

- [ ] **Step 2: Spot-check the manifest**

Run: `python3 -c "import json; m = json.load(open('data/audio/manifest.json')); print(len(m))"`
Expected: a number visibly larger than before this task (new lesson content adds roughly 140-160 new distinct phrases on top of whatever was already cached).

- [ ] **Step 3: Flip the roadmap status to published**

In `data/lessons.json`, find `courseRoadmap.levels[0]` (the A1 roadmap entry, `id: "roadmap:a1"`). Change:

```json
"status": "in-progress",
```

to:

```json
"status": "published",
```

Leave `claim` and everything else in that object unchanged — it already correctly distinguishes "content published" from "separately verified against CEFR/DELF."

- [ ] **Step 4: Update the two roadmap-status assertions in `tests/smoke.mjs`**

Line 48 currently reads:

```js
assert.equal(roadmapLevels.get("A1").status, "in-progress");
```

Replace with:

```js
assert.equal(roadmapLevels.get("A1").status, "published");
```

Lines 50-53 currently read:

```js
assert.ok(
  data.courseRoadmap.levels.every((level) => level.status !== "published"),
  "No future CEFR level should be published before real lessons/evidence exist"
);
```

Replace with:

```js
assert.ok(
  data.courseRoadmap.levels.filter((level) => level.cefrLevel !== "A1").every((level) => level.status !== "published"),
  "No CEFR level beyond the completed A1 should be published before real lessons/evidence exist"
);
```

- [ ] **Step 5: Update `README.md`**

In the intro paragraph (currently: `Текущий набор — **Starter**, а не полный курс до уровня B2. Архитектура поддерживает уровни и модули A0-B2, а в \`data/lessons.json\` есть \`courseRoadmap\` для A1/A2/B1/B2. ...`), change the first sentence to:

```
Текущий набор покрывает **Starter (Pre-A1/A1 основа) и A1** практическим объёмом — 22 урока, не полный курс до уровня B2.
```

Keep the rest of that paragraph (the roadmap/claimPolicy explanation) unchanged — it still accurately describes A2/B1/B2.

In the `## Структура` section, the line describing `data/lessons.json` currently reads:

```
- `data/lessons.json` - уроки, грамматика, произношение, словарь, открытые ресурсы и roadmap A1-B2.
```

Replace with:

```
- `data/lessons.json` - уроки (starter + A1, 22 урока), грамматика, произношение, словарь, открытые ресурсы и roadmap A2-B2.
```

- [ ] **Step 6: Run the full test suite**

Run each of these from the repo root and confirm every one exits 0 with no assertion errors:

```bash
node tests/smoke.mjs
node tests/exercises.mjs
node tests/mastery.mjs
node tests/technical.mjs
node tests/card-manifest.mjs
node tests/tts-cache.mjs
python3 tests/test_server.py
python3 tests/test_prewarm.py
```

Expected: `smoke.mjs` prints `Smoke tests passed: 22 lessons, 66 exercises, ...`; `card-manifest.mjs` prints `Legacy card manifest passed: 77 protected identities, <N> additive cards.` where `<N>` is now visibly larger than before (all-new vocabulary from `l12`-`l22` adds cards, but the 77 legacy identities are untouched); the rest print their own pass confirmations with no thrown errors.

- [ ] **Step 7: Commit**

```bash
git add data/lessons.json data/audio tests/smoke.mjs README.md
git commit -m "$(cat <<'EOF'
feat: publish A1 roadmap status, prewarm new lesson audio, update docs

All 11 A1 lessons (l12-l22) are in place with evidence across all 7
skill axes (courseRoadmap.skillAxes). Flip roadmap:a1 status to
published and update the two smoke.mjs guardrails that previously kept
this from happening prematurely.
EOF
)"
```

## Self-Review

**Spec coverage:** every section of `docs/superpowers/specs/2026-07-09-close-a1-content-design.md` maps to a task — architecture (Task 3 + module tasks), point fixes (Tasks 1-2), all 11 lessons (Tasks 3-13), grammar (folded into the lesson task that first needs each topic), audio (Task 14), docs (Task 14), tests (Tasks 1, 2, 3, 14 + implicit `smoke.mjs` coverage on every task).

**Placeholder scan:** no TBD/TODO; every exercise has real `acceptedAnswers`/`modelAnswer`/`hints`/`rubric` content where required; every JSON object is complete, not elided.

**Type/reference consistency, checked by hand against `course-validator.js` before writing this plan:** every exercise has non-empty `hints` and non-empty, locally-resolvable `objectiveIds`; every `reading-comprehension` has `sourceText`; every `listening-comprehension`/`dictation` has `transcript`; every self-reviewed type (`guided-writing, summarize-for-a-friend, recorded-monologue, message-reply, conversation-prompt, roleplay`) used here has non-empty `rubric`; every lesson's two-or-three `objectives` are each covered by at least one exercise's `objectiveIds`; every id uses its required prefix (`obj:`, `vocab:`, `phrase:`); every `lessons[].order` is unique within its `moduleId`; every `modules[].order` is unique within its `levelId`; the `a1` level's `order: 2` doesn't collide with `starter`'s `order: 1`. Grammar/pronunciation topic ids referenced by each lesson exist by the time that lesson is added (traced module-by-module in the Global Constraints section).

**Deviation from the spec, flagged explicitly:** the spec estimated 6 new `grammarTopics`; while drafting real content it became clear `l20` (possessives) and `l21` (adjective agreement) each needed a genuine new grammar point the spec hadn't named individually, and conversely a standalone "numbers" topic turned out unnecessary (folded into `avoir`/`il-y-a`). Net result is still 6 new topics, just not the same 6 the spec listed by name. Vocabulary also lands lower than the spec's already-revised estimate (175-195): the established per-lesson convention (`l01`-`l11` average ~4 words/lesson, strictly mined from the dialogue) is tighter than the 12-16/lesson the spec assumed: this plan lands around **98 new words (45 → ~143 total)**, using richer lists specifically where a topic is a naturally enumerable closed set (numbers, days, family) and staying tight elsewhere. This is reported here rather than forced to match the older estimate.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-09-close-a1-content.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
