# Numbers Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a 3-lesson mini-module (`l08a`/`l08b`/`l08c`, module `module:starter:numbers`) between `l08` and `l09` in `data/lessons.json` that teaches the full French cardinal number system (0 → billion), retire the narrower `l14` it replaces, and keep every existing test/guardrail green.

**Architecture:** Pure content change against the existing schema (`course-schema.js`) and validator (`course-validator.js`) — no new UI/engine code. Every task is a `data/lessons.json` edit checked by `node tests/smoke.mjs`. Lesson order in the app comes from `order`/`moduleId` fields (`app.js:compareLessons`), not from the numeric part of the lesson id, so inserting `l08a`/`l08b`/`l08c` never requires renaming `l01`-`l38` — existing user progress in `user-data/french-study-data.json` (keyed by strings like `vocab:l09:0:ru-fr`) stays valid throughout.

**Tech Stack:** Vanilla JS (ESM), `data/lessons.json` (schema v3), Python `scripts/prewarm_tts.py` + `server.py` (edge-tts), Node's built-in test runner style (`node tests/*.mjs`).

Reference spec: [docs/superpowers/specs/2026-07-12-numbers-block-design.md](../specs/2026-07-12-numbers-block-design.md)

## Global Constraints

- `data/lessons.json` schema (`course-schema.js`) requires every lesson to carry: `id, level, title, goal, scenario, targetPhrase, pronunciationTopic, grammarTopic, moduleId, order, prerequisites[], objectives[], tags[], dialogue[], vocabulary[], exercises[], cards[]`.
- Id prefixes enforced by `course-validator.js:registerId`: `objectives[].id` → `obj:`, `vocabulary[].id` → `vocab:`, `cards[].id` → `phrase:` (regardless of card `type`, including cloze). Lesson/module/grammarTopic ids have no required prefix but must match `/^[A-Za-z0-9][A-Za-z0-9:._-]*$/`.
- House pattern (all of `l01`-`l38`, kept here): **exactly 3 exercises, exactly 3 cards** per lesson. `prerequisites` chains linearly to the immediately preceding lesson id — `mastery.checkCatalogLessonPrerequisites` (`mastery.js:76`) also walks the module/level prerequisite closure and requires **every** lesson in a prerequisite module to be completed, so this direct chain is redundant-but-consistent with house style, not load-bearing on its own.
- Exercise validation rules that every new exercise must satisfy (`course-validator.js`): `hints` non-empty; `objectiveIds` non-empty and must reference an objective id declared in the *same* lesson; `reading-comprehension` requires `sourceText`; `dictation`/`listening-comprehension` require `transcript` (set `listenText` to the same string too — `app.js` prefers it for the "Прослушать" button). None of the exercise types used in this plan (`controlled-production`, `gap-fill`, `translate`, `dictation`, `reading-comprehension`) require a `rubric`.
- Canonical skill axis ids (`courseRoadmap.skillAxes` in `data/lessons.json`): `listening, reading, spoken-interaction, spoken-production, written-production, mediation, language-system`. Every new `objectives[].skill` in this plan is `language-system` or `reading`.
- Module `order` must be unique per `levelId`, lesson `order` must be unique per `moduleId` (`course-validator.js:validateUniqueOrders`) — inserting `module:starter:numbers` at `order: 5` requires bumping `module:starter:reception-review` to `order: 6` in the *same commit*, or the suite fails on a duplicate-order error.
- All JSON content below was dry-run validated against the real `course-validator.js` and `cards.js:buildCards` before writing this plan (see verification note at the end) — every task's JSON is copy-paste ready, not illustrative.
- Content tasks don't follow classic red/green TDD — there's no test independent of the content itself. Each content step is: edit the JSON, run `node tests/smoke.mjs`, confirm the expected lesson/exercise counts and a clean pass.
- Commit after every task (conventional-commit-style prefixes matching this repo's history: `feat:`, `fix:`, `docs:`).
- Run all commands from the repo root: `/Users/andreylodegov/Documents/French_study`.

## File Structure

- Modify: `data/lessons.json` — every task touches it (`modules[]`, `grammarTopics[]`, `lessons[]`).
- Modify: `tests/smoke.mjs` — the two hardcoded guardrail assertions (`data.lessons.length`, exercise count) at lines 25 and 76 change once per task that alters the counts (Tasks 1-4).
- Modify: `README.md` — Task 6 (lesson/exercise counts).
- Create (generated, not hand-written): `data/audio/*.mp3`, modify `data/audio/manifest.json` — Task 7, via running the prewarm script.

---

### Task 1: Module `numbers` + lesson `l08a` (0-20, reuses `il-y-a`)

**Files:**
- Modify: `data/lessons.json` (`modules[]`, `lessons[]`)
- Modify: `tests/smoke.mjs:25,76`

**Interfaces:**
- Consumes: existing `il-y-a` grammarTopic, existing `liaison` pronunciationTopic, prerequisite lesson `l08` (existing).
- Produces: module id `module:starter:numbers`, lesson id `l08a` — Task 2 (`l08b`) chains `prerequisites: ["l08a"]` to this.

- [ ] **Step 1: Bump `module:starter:reception-review`'s order and prerequisites**

In `data/lessons.json`, find the `module:starter:reception-review` object in the top-level `modules` array. Current:

```json
{
  "id": "module:starter:reception-review",
  "levelId": "starter",
  "title": "Первые тексты и объявления",
  "description": "Чтение меню, понимание короткого объявления, диктант и мини-медиация.",
  "order": 5,
  "prerequisites": [
    "module:starter:help"
  ]
}
```

Change `order` to `6` and `prerequisites` to `["module:starter:numbers"]`:

```json
{
  "id": "module:starter:reception-review",
  "levelId": "starter",
  "title": "Первые тексты и объявления",
  "description": "Чтение меню, понимание короткого объявления, диктант и мини-медиация.",
  "order": 6,
  "prerequisites": [
    "module:starter:numbers"
  ]
}
```

- [ ] **Step 2: Insert the `module:starter:numbers` module**

Immediately before the `module:starter:reception-review` object (i.e. right after `module:starter:help`), insert:

```json
{
  "id": "module:starter:numbers",
  "levelId": "starter",
  "title": "Числа: считаем по-французски",
  "description": "Полная система счёта: от нуля до миллиарда.",
  "order": 5,
  "prerequisites": [
    "module:starter:help"
  ]
}
```

- [ ] **Step 3: Insert lesson `l08a`**

In the top-level `lessons` array, insert this object immediately after `l08` (before `l09`):

```json
{
  "id": "l08a",
  "level": "A1",
  "title": "Числа 0-20: считаем с нуля",
  "goal": "Называть числа 0-20 и использовать il y a, чтобы говорить о количестве.",
  "scenario": "counting-basics",
  "targetPhrase": "Il y a combien de personnes ? Il y a dix personnes.",
  "pronunciationTopic": "liaison",
  "grammarTopic": "il-y-a",
  "moduleId": "module:starter:numbers",
  "order": 1,
  "prerequisites": [
    "l08"
  ],
  "tags": [
    "numbers",
    "il-y-a",
    "counting"
  ],
  "objectives": [
    {
      "id": "obj:l08a:count-zero-to-twenty",
      "skill": "language-system",
      "cefrCanDo": "Может называть и использовать числа 0-20.",
      "required": true
    },
    {
      "id": "obj:l08a:use-il-y-a",
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
      "fr": "Oui, il y a quinze chaises.",
      "ipa": "/wi il i a kɛ̃z ʃɛz/",
      "ru": "Да, пятнадцать стульев."
    }
  ],
  "vocabulary": [
    {"id": "vocab:l08a:0", "fr": "zéro", "ipa": "/ze.ʁo/", "ru": "ноль", "note": "Ударение на последнем слоге, как обычно во французском."},
    {"id": "vocab:l08a:1", "fr": "un", "ipa": "/ɛ̃/", "ru": "один", "note": "Носовой звук, как в un café."},
    {"id": "vocab:l08a:2", "fr": "deux", "ipa": "/dø/", "ru": "два", "note": "Закрытый звук eu, губы округлены, как в peu."},
    {"id": "vocab:l08a:3", "fr": "trois", "ipa": "/tʁwa/", "ru": "три", "note": "oi читается как /wa/."},
    {"id": "vocab:l08a:4", "fr": "quatre", "ipa": "/katʁ/", "ru": "четыре", "note": "Финальное e не звучит."},
    {"id": "vocab:l08a:5", "fr": "cinq", "ipa": "/sɛ̃k/", "ru": "пять", "note": "Перед паузой q звучит; перед согласной иногда пропадает: cinq minutes."},
    {"id": "vocab:l08a:6", "fr": "six", "ipa": "/sis/", "ru": "шесть", "note": "Перед согласной звучит /si/, перед гласной /siz/."},
    {"id": "vocab:l08a:7", "fr": "sept", "ipa": "/sɛt/", "ru": "семь", "note": "Финальная t звучит — редкое исключение среди чисел."},
    {"id": "vocab:l08a:8", "fr": "huit", "ipa": "/ɥit/", "ru": "восемь", "note": "h немое, слово начинается со звука /ɥ/."},
    {"id": "vocab:l08a:9", "fr": "neuf", "ipa": "/nœf/", "ru": "девять", "note": "Перед heures/ans звучит как /nœv/: neuf heures."},
    {"id": "vocab:l08a:10", "fr": "dix", "ipa": "/dis/", "ru": "десять", "note": "Перед согласной /di/, перед гласной /diz/."},
    {"id": "vocab:l08a:11", "fr": "onze", "ipa": "/ɔ̃z/", "ru": "одиннадцать", "note": "Начинается с гласной, но liaison перед onze не делается."},
    {"id": "vocab:l08a:12", "fr": "douze", "ipa": "/duz/", "ru": "двенадцать", "note": "u — закрытый звук, как в vous."},
    {"id": "vocab:l08a:13", "fr": "treize", "ipa": "/tʁɛz/", "ru": "тринадцать", "note": "ei читается как открытое /ɛ/."},
    {"id": "vocab:l08a:14", "fr": "quatorze", "ipa": "/ka.tɔʁz/", "ru": "четырнадцать", "note": "Ударение на последнем слоге."},
    {"id": "vocab:l08a:15", "fr": "quinze", "ipa": "/kɛ̃z/", "ru": "пятнадцать", "note": "Носовой звук в начале, как в cinq."},
    {"id": "vocab:l08a:16", "fr": "seize", "ipa": "/sɛz/", "ru": "шестнадцать", "note": "Похоже по звучанию на treize, не перепутай."},
    {"id": "vocab:l08a:17", "fr": "dix-sept", "ipa": "/di.sɛt/", "ru": "семнадцать", "note": "dix перед согласной без z: /di/ + sept."},
    {"id": "vocab:l08a:18", "fr": "dix-huit", "ipa": "/di.zɥit/", "ru": "восемнадцать", "note": "Перед немым h — liaison, dix звучит /diz/."},
    {"id": "vocab:l08a:19", "fr": "dix-neuf", "ipa": "/diz.nœf/", "ru": "девятнадцать", "note": "Тоже liaison: /diz/ + neuf."},
    {"id": "vocab:l08a:20", "fr": "vingt", "ipa": "/vɛ̃/", "ru": "двадцать", "note": "Финальное t не звучит в одиночном слове, но появляется в vingt et un."}
  ],
  "exercises": [
    {
      "id": "l08a-e1",
      "type": "controlled-production",
      "prompt": "Реши и назови по-французски: 5+7=? 8+9=? 6+9=?",
      "acceptedAnswers": [],
      "modelAnswer": "5+7 = douze. 8+9 = dix-sept. 6+9 = quinze.",
      "hints": ["Складывай как в уме по-русски, потом называй результат по-французски."],
      "requiredTokens": ["douze", "dix-sept", "quinze"],
      "objectiveIds": ["obj:l08a:count-zero-to-twenty"],
      "explanation": "Числа 0-20 — основа для всех дальнейших вычислений и цен."
    },
    {
      "id": "l08a-e2",
      "type": "gap-fill",
      "prompt": "Заполни: ___ onze personnes dans la salle.",
      "acceptedAnswers": ["Il y a"],
      "modelAnswer": "Il y a onze personnes dans la salle.",
      "hints": ["Стандартная формула наличия/количества, не меняется по числам."],
      "requiredTokens": [],
      "objectiveIds": ["obj:l08a:use-il-y-a"],
      "explanation": "Il y a не согласуется ни с родом, ни с числом существительного."
    },
    {
      "id": "l08a-e3",
      "type": "dictation",
      "prompt": "Диктант: прослушай и запиши фразу полностью.",
      "transcript": "Il y a quinze personnes et huit chaises.",
      "listenText": "Il y a quinze personnes et huit chaises.",
      "acceptedAnswers": ["Il y a quinze personnes et huit chaises."],
      "modelAnswer": "Il y a quinze personnes et huit chaises.",
      "hints": ["Два числа подряд — quinze и huit, слушай внимательно."],
      "requiredTokens": [],
      "objectiveIds": ["obj:l08a:use-il-y-a"],
      "explanation": "Диктант закрепляет числа на слух в связке с il y a."
    }
  ],
  "cards": [
    {"id": "phrase:l08a:0", "front": "Сколько человек?", "back": "Il y a combien de personnes ?", "type": "phrase"},
    {"id": "phrase:l08a:1", "front": "Десять человек.", "back": "Il y a dix personnes.", "type": "phrase"},
    {"id": "phrase:l08a:2", "front": "Il y a {{c1::quinze}} chaises.", "back": "Есть пятнадцать стульев.", "type": "cloze"}
  ]
}
```

- [ ] **Step 4: Update the two guardrail assertions in `tests/smoke.mjs`**

Line 25 currently reads:

```js
assert.equal(data.lessons.length, 38, "The practical A1 release contains 38 lessons");
```

Replace with:

```js
assert.equal(data.lessons.length, 39, "The catalog grows to 39 lessons once l08a (numbers 0-20) ships");
```

Line 76 currently reads:

```js
assert.equal(exercises.length, 118, "38 lessons include 118 exercises with a seven-part checkpoint");
```

Replace with:

```js
assert.equal(exercises.length, 121, "39 lessons include 121 exercises with a seven-part checkpoint");
```

- [ ] **Step 5: Run the suite, confirm it passes**

Run: `node tests/smoke.mjs`
Expected: `Smoke tests passed: 39 lessons, 121 exercises, ...` and exit 0.

- [ ] **Step 6: Commit**

```bash
git add data/lessons.json tests/smoke.mjs
git commit -m "$(cat <<'EOF'
feat: add module starter:numbers, lesson l08a (numbers 0-20)

First lesson of the new numbers mini-module inserted before l09
(Menu et prix). Reuses the existing il-y-a grammarTopic instead of
duplicating it, since l14 (which owned il-y-a until now) is being
retired later in this plan.
EOF
)"
```

---

### Task 2: Lesson `l08b` (20-100, irregular 70-99) + grammarTopic `numbers-tens`

**Files:**
- Modify: `data/lessons.json` (`grammarTopics[]`, `lessons[]`)
- Modify: `tests/smoke.mjs:25,76`

**Interfaces:**
- Consumes: module `module:starter:numbers` (Task 1), prerequisite lesson `l08a` (Task 1), existing `nasals` pronunciationTopic.
- Produces: grammarTopic `numbers-tens`, lesson id `l08b` — Task 3 (`l08c`) chains `prerequisites: ["l08b"]` to this.

- [ ] **Step 1: Add the `numbers-tens` grammarTopic**

In the top-level `grammarTopics` array, insert this object immediately after `likes-reasons` (the last existing entry):

```json
{
  "id": "numbers-tens",
  "title": "Числа 20-100: десятки и вигезимальная система 70-99",
  "level": "A1",
  "rule": "Десятки 20-60 образуются регулярно (vingt, trente, quarante, cinquante, soixante). С 70 начинается счёт по двадцаткам: 70 = soixante-dix (60+10), 80 = quatre-vingts (4×20), 90 = quatre-vingt-dix (4×20+10). В числах на 1 используется et без дефиса (vingt et un), кроме случаев после quatre-vingt(s), где всегда дефис без et: quatre-vingt-un. Soixante et onze (71) — единственное исключение с et в зоне 70-х.",
  "examples": [
    "Il y a trente-cinq personnes.",
    "Ça fait soixante et onze euros.",
    "Il y a quatre-vingts chaises.",
    "Ça fait quatre-vingt-dix-neuf euros."
  ],
  "paradigm": [
    {"label": "20-60 (регулярно)", "form": "vingt, trente, quarante, cinquante, soixante"},
    {"label": "70-79 (60+10..19)", "form": "soixante-dix, soixante et onze, soixante-douze..."},
    {"label": "80-89 (4×20)", "form": "quatre-vingts, quatre-vingt-un, quatre-vingt-deux..."},
    {"label": "90-99 (4×20+10..19)", "form": "quatre-vingt-dix, quatre-vingt-onze, quatre-vingt-douze..."}
  ],
  "commonMistakes": [
    {
      "wrong": "septante, huitante/octante, nonante (бельгийский/швейцарский счёт)",
      "right": "во французском французском — только soixante-dix, quatre-vingts, quatre-vingt-dix",
      "note": "Эти формы существуют в Бельгии и Швейцарии, но не используются во Франции."
    },
    {
      "wrong": "quatre-vingts un (s перед другим числом)",
      "right": "quatre-vingt-un — s пропадает, как только после quatre-vingt идёт ещё одно число",
      "note": "s остаётся только в ровном числе 80: quatre-vingts euros."
    }
  ],
  "exceptions": [
    {
      "wrong": "soixante-onze (по аналогии с quatre-vingt-onze)",
      "right": "soixante et onze — единственное число в 70-х с et",
      "note": "Все остальные 72-79 образуются без et: soixante-douze, soixante-treize..."
    }
  ]
}
```

- [ ] **Step 2: Insert lesson `l08b`**

In the top-level `lessons` array, insert this object immediately after `l08a`:

```json
{
  "id": "l08b",
  "level": "A1",
  "title": "Числа 20-100: десятки и особая логика 70-99",
  "goal": "Использовать десятки 20-100, включая нерегулярную зону 70-99, и применять правило et/дефис.",
  "scenario": "counting-tens",
  "targetPhrase": "Ça fait quatre-vingt-dix-neuf euros.",
  "pronunciationTopic": "nasals",
  "grammarTopic": "numbers-tens",
  "moduleId": "module:starter:numbers",
  "order": 2,
  "prerequisites": [
    "l08a"
  ],
  "tags": [
    "numbers",
    "tens",
    "irregular"
  ],
  "objectives": [
    {
      "id": "obj:l08b:use-irregular-70-99",
      "skill": "language-system",
      "cefrCanDo": "Может образовывать и произносить числа 70-99 (soixante-dix, quatre-vingts, quatre-vingt-dix).",
      "required": true
    },
    {
      "id": "obj:l08b:apply-et-hyphen-rule",
      "skill": "language-system",
      "cefrCanDo": "Может применять правило et/дефис в составных числах (vingt et un, quatre-vingt-un).",
      "required": true
    }
  ],
  "dialogue": [
    {
      "speaker": "Vendeuse",
      "fr": "Alors, ça fait combien en tout ?",
      "ipa": "/a.lɔʁ sa fɛ kɔ̃.bjɛ̃ ɑ̃ tu/",
      "ru": "Итак, сколько это выходит всего?"
    },
    {
      "speaker": "Client",
      "fr": "Attendez... ça fait quatre-vingt-quinze euros.",
      "ipa": "/a.tɑ̃.de sa fɛ katʁ.vɛ̃.kɛ̃z ø.ʁo/",
      "ru": "Подождите... это выходит девяносто пять евро."
    },
    {
      "speaker": "Vendeuse",
      "fr": "Et avec la réduction, soixante-dix-neuf euros.",
      "ipa": "/e a.vɛk la ʁe.dyk.sjɔ̃ swa.sɑ̃t.dis.nœf ø.ʁo/",
      "ru": "А со скидкой — семьдесят девять евро."
    },
    {
      "speaker": "Client",
      "fr": "Parfait, merci !",
      "ipa": "/paʁ.fɛ mɛʁ.si/",
      "ru": "Отлично, спасибо!"
    }
  ],
  "vocabulary": [
    {"id": "vocab:l08b:0", "fr": "trente", "ipa": "/tʁɑ̃t/", "ru": "тридцать", "note": "Дальше все круглые десятки по этой модели: quarante, cinquante, soixante."},
    {"id": "vocab:l08b:1", "fr": "quarante", "ipa": "/ka.ʁɑ̃t/", "ru": "сорок", "note": "Похоже на trente по структуре."},
    {"id": "vocab:l08b:2", "fr": "cinquante", "ipa": "/sɛ̃.kɑ̃t/", "ru": "пятьдесят", "note": "Носовой в начале, как в cinq."},
    {"id": "vocab:l08b:3", "fr": "soixante", "ipa": "/swa.sɑ̃t/", "ru": "шестьдесят", "note": "Последний регулярный десяток — дальше начинается особая логика."},
    {"id": "vocab:l08b:4", "fr": "soixante-dix", "ipa": "/swa.sɑ̃t.dis/", "ru": "семьдесят", "note": "Дословно «шестьдесят-десять»; отдельного слова septante во Франции нет."},
    {"id": "vocab:l08b:5", "fr": "quatre-vingts", "ipa": "/katʁ.vɛ̃/", "ru": "восемьдесят", "note": "Дословно «четыре двадцатки»; s остаётся только в ровном числе 80."},
    {"id": "vocab:l08b:6", "fr": "quatre-vingt-dix", "ipa": "/katʁ.vɛ̃.dis/", "ru": "девяносто", "note": "«Четыре двадцатки плюс десять» — nonante не используется во Франции."},
    {"id": "vocab:l08b:7", "fr": "vingt et un", "ipa": "/vɛ̃.t‿e ɛ̃/", "ru": "двадцать один", "note": "Модель «X et un» работает для 21, 31, 41, 51, 61."},
    {"id": "vocab:l08b:8", "fr": "soixante et onze", "ipa": "/swa.sɑ̃.t‿e ɔ̃z/", "ru": "семьдесят один", "note": "Единственное исключение в 70-х: et есть, но перед onze, не перед un."},
    {"id": "vocab:l08b:9", "fr": "quatre-vingt-un", "ipa": "/katʁ.vɛ̃.ɛ̃/", "ru": "восемьдесят один", "note": "После quatre-vingt(s) и cent нет et — сразу дефис."},
    {"id": "vocab:l08b:10", "fr": "quatre-vingt-onze", "ipa": "/katʁ.vɛ̃.ɔ̃z/", "ru": "девяносто один", "note": "Тот же принцип: без et, просто дефис."},
    {"id": "vocab:l08b:11", "fr": "cent", "ipa": "/sɑ̃/", "ru": "сто", "note": "Замыкает сотню; дальше начинается урок о больших числах."}
  ],
  "exercises": [
    {
      "id": "l08b-e1",
      "type": "controlled-production",
      "prompt": "Назови по-французски: 71, 80, 91, 99.",
      "acceptedAnswers": [],
      "modelAnswer": "71 = soixante et onze. 80 = quatre-vingts. 91 = quatre-vingt-onze. 99 = quatre-vingt-dix-neuf.",
      "hints": ["70-99 не образуются как обычные десятки — используй soixante-dix и quatre-vingt(s) как базу."],
      "requiredTokens": ["quatre-vingts", "quatre-vingt-onze"],
      "objectiveIds": ["obj:l08b:use-irregular-70-99"],
      "explanation": "Это самая нерегулярная зона французских числительных — стоит выучить как блок."
    },
    {
      "id": "l08b-e2",
      "type": "gap-fill",
      "prompt": "Заполни пропуск, чтобы получилось «девяносто один»: quatre-vingt-___.",
      "acceptedAnswers": ["onze"],
      "modelAnswer": "quatre-vingt-onze",
      "hints": ["После quatre-vingt et не нужен — сразу число через дефис."],
      "requiredTokens": [],
      "objectiveIds": ["obj:l08b:apply-et-hyphen-rule"],
      "explanation": "quatre-vingt-onze — дефис, без et, в отличие от vingt et un."
    },
    {
      "id": "l08b-e3",
      "type": "translate",
      "prompt": "Переведи: В группе тридцать пять человек. В зале восемьдесят стульев.",
      "acceptedAnswers": ["Il y a trente-cinq personnes dans le groupe. Il y a quatre-vingts chaises dans la salle."],
      "modelAnswer": "Il y a trente-cinq personnes dans le groupe. Il y a quatre-vingts chaises dans la salle.",
      "hints": ["Обе фразы строятся через il y a — эта грамматика уже знакома из прошлого урока."],
      "requiredTokens": [],
      "objectiveIds": ["obj:l08b:use-irregular-70-99"],
      "explanation": "Quatre-vingts пишется с s, потому что это ровно 80, без добавочного числа."
    }
  ],
  "cards": [
    {"id": "phrase:l08b:0", "front": "Сколько это выходит всего?", "back": "Ça fait combien en tout ?", "type": "phrase"},
    {"id": "phrase:l08b:1", "front": "Это выходит девяносто пять евро.", "back": "Ça fait quatre-vingt-quinze euros.", "type": "phrase"},
    {"id": "phrase:l08b:2", "front": "Ça fait {{c1::soixante-dix-neuf}} euros.", "back": "Это выходит семьдесят девять евро.", "type": "cloze"}
  ]
}
```

- [ ] **Step 3: Update the two guardrail assertions in `tests/smoke.mjs`**

```js
assert.equal(data.lessons.length, 40, "The catalog grows to 40 lessons once l08b (numbers 20-100) ships");
```

```js
assert.equal(exercises.length, 124, "40 lessons include 124 exercises with a seven-part checkpoint");
```

- [ ] **Step 4: Run the suite, confirm it passes**

Run: `node tests/smoke.mjs`
Expected: `Smoke tests passed: 40 lessons, 124 exercises, ...` and exit 0.

- [ ] **Step 5: Commit**

```bash
git add data/lessons.json tests/smoke.mjs
git commit -m "feat: add lesson l08b (numbers 20-100, irregular 70-99) + numbers-tens grammarTopic"
```

---

### Task 3: Lesson `l08c` (100+) + grammarTopic `numbers-large` + `l09` prerequisite update

**Files:**
- Modify: `data/lessons.json` (`grammarTopics[]`, `lessons[]`)
- Modify: `tests/smoke.mjs:25,76`

**Interfaces:**
- Consumes: module `module:starter:numbers` (Task 1), prerequisite lesson `l08b` (Task 2), existing `silent-endings` pronunciationTopic.
- Produces: grammarTopic `numbers-large`, lesson id `l08c`. This task also rewires `l09.prerequisites` to `["l08c"]`, completing the insertion chain `l08 → l08a → l08b → l08c → l09`.

- [ ] **Step 1: Add the `numbers-large` grammarTopic**

In the top-level `grammarTopics` array, insert this object immediately after `numbers-tens`:

```json
{
  "id": "numbers-large",
  "title": "Числа 100+: сотни, тысячи, миллионы, миллиарды",
  "level": "A1",
  "rule": "Cent получает s только в ровных сотнях без добавочного числа (deux cents), и теряет s, как только после него идёт ещё одно число (deux cent trois). Mille никогда не меняется и не берёт артикль un перед собой (mille, а не un mille). Million и milliard — обычные существительные, а не числительные: они согласуются во множественном числе (deux millions) и требуют de перед следующим существительным (un million de personnes, un milliard de dollars).",
  "examples": [
    "Il y a deux cents personnes.",
    "Il y a deux cent trois personnes.",
    "Cette ville a mille habitants.",
    "Il y a un million d'habitants.",
    "Il y a deux milliards de dollars."
  ],
  "paradigm": [
    {"label": "cent ровно", "form": "deux cents (200)"},
    {"label": "cent + число", "form": "deux cent trois (203) — без s"},
    {"label": "mille", "form": "mille, deux mille, cent mille — не меняется"},
    {"label": "million/milliard + сущ.", "form": "un million de dollars, deux millions d'habitants"}
  ],
  "commonMistakes": [
    {
      "wrong": "un mille euros",
      "right": "mille euros — mille никогда не берёт артикль un перед собой",
      "note": "В отличие от million/milliard, mille — неизменяемое числительное, а не существительное."
    },
    {
      "wrong": "un million habitants (без de)",
      "right": "un million d'habitants — de обязателен, потому что million/milliard — существительные",
      "note": "Та же модель, что un kilo de pommes."
    }
  ],
  "exceptions": [
    {
      "wrong": "deux cents trois (s остаётся перед числом)",
      "right": "deux cent trois — s исчезает, как только после cent идёт ещё одна цифра",
      "note": "То же правило работает для quatre-vingts: s только в ровном числе."
    }
  ]
}
```

- [ ] **Step 2: Insert lesson `l08c`**

In the top-level `lessons` array, insert this object immediately after `l08b`:

```json
{
  "id": "l08c",
  "level": "A1",
  "title": "Числа 100 и больше: сотни, тысячи, миллионы, миллиарды",
  "goal": "Использовать сотни, тысячи, миллионы и миллиарды, включая согласование cent и правило de после million/milliard.",
  "scenario": "counting-large-numbers",
  "targetPhrase": "Cette ville a deux millions d'habitants.",
  "pronunciationTopic": "silent-endings",
  "grammarTopic": "numbers-large",
  "moduleId": "module:starter:numbers",
  "order": 3,
  "prerequisites": [
    "l08b"
  ],
  "tags": [
    "numbers",
    "large-numbers",
    "million"
  ],
  "objectives": [
    {
      "id": "obj:l08c:agree-cent-mille",
      "skill": "language-system",
      "cefrCanDo": "Может правильно согласовывать cent (deux cents / deux cent trois) и использовать неизменяемое mille.",
      "required": true
    },
    {
      "id": "obj:l08c:use-de-after-million-milliard",
      "skill": "language-system",
      "cefrCanDo": "Может использовать de после million/milliard перед существительным.",
      "required": true
    },
    {
      "id": "obj:l08c:read-big-numbers",
      "skill": "reading",
      "cefrCanDo": "Может найти и понять большие числа (сотни тысяч, миллионы) в коротком тексте.",
      "required": true
    }
  ],
  "dialogue": [
    {
      "speaker": "Touriste",
      "fr": "Paris a combien d'habitants ?",
      "ipa": "/pa.ʁi a kɔ̃.bjɛ̃ d‿a.bi.tɑ̃/",
      "ru": "Сколько жителей в Париже?"
    },
    {
      "speaker": "Guide",
      "fr": "Paris a environ deux millions d'habitants.",
      "ipa": "/pa.ʁi a ɑ̃.vi.ʁɔ̃ dø mi.ljɔ̃ d‿a.bi.tɑ̃/",
      "ru": "В Париже около двух миллионов жителей."
    },
    {
      "speaker": "Touriste",
      "fr": "Et la région parisienne ?",
      "ipa": "/e la ʁe.ʒjɔ̃ pa.ʁi.zjɛn/",
      "ru": "А парижский регион?"
    },
    {
      "speaker": "Guide",
      "fr": "Plus de douze millions de personnes.",
      "ipa": "/plys də duz mi.ljɔ̃ də pɛʁ.sɔn/",
      "ru": "Более двенадцати миллионов человек."
    }
  ],
  "vocabulary": [
    {"id": "vocab:l08c:0", "fr": "cent", "ipa": "/sɑ̃/", "ru": "сто", "note": "Финальная t никогда не звучит, даже во множественном числе."},
    {"id": "vocab:l08c:1", "fr": "cent un", "ipa": "/sɑ̃.ɛ̃/", "ru": "сто один", "note": "После cent никогда не бывает et, в отличие от vingt et un."},
    {"id": "vocab:l08c:2", "fr": "deux cents", "ipa": "/dø sɑ̃/", "ru": "двести", "note": "s появляется, потому что это ровно круглое число."},
    {"id": "vocab:l08c:3", "fr": "deux cent trois", "ipa": "/dø sɑ̃ tʁwa/", "ru": "двести три", "note": "s у cent пропадает, как только после него идёт другое число."},
    {"id": "vocab:l08c:4", "fr": "mille", "ipa": "/mil/", "ru": "тысяча", "note": "Никогда не изменяется: mille, deux mille, dix mille — без s, без артикля un перед mille."},
    {"id": "vocab:l08c:5", "fr": "dix mille", "ipa": "/di mil/", "ru": "десять тысяч", "note": "Dix перед согласной m — без z."},
    {"id": "vocab:l08c:6", "fr": "cent mille", "ipa": "/sɑ̃ mil/", "ru": "сто тысяч", "note": "Cent тут тоже без s — mille не считается «ещё одним числом»."},
    {"id": "vocab:l08c:7", "fr": "un million", "ipa": "/ɛ̃ mi.ljɔ̃/", "ru": "миллион", "note": "Это существительное, а не число: перед следующим словом нужен de — un million d'habitants."},
    {"id": "vocab:l08c:8", "fr": "deux millions", "ipa": "/dø mi.ljɔ̃/", "ru": "два миллиона", "note": "Как обычное существительное, во множественном числе получает s."},
    {"id": "vocab:l08c:9", "fr": "un milliard", "ipa": "/ɛ̃ mi.ljaʁ/", "ru": "миллиард", "note": "Тот же принцип, что и million: un milliard de dollars."},
    {"id": "vocab:l08c:10", "fr": "environ", "ipa": "/ɑ̃.vi.ʁɔ̃/", "ru": "около, примерно", "note": "Полезно перед приблизительными большими числами."}
  ],
  "exercises": [
    {
      "id": "l08c-e1",
      "type": "controlled-production",
      "prompt": "Назови по-французски: 200, 203, 1000, 2 000 000.",
      "acceptedAnswers": [],
      "modelAnswer": "200 = deux cents. 203 = deux cent trois. 1000 = mille. 2 000 000 = deux millions.",
      "hints": ["s у cent остаётся только в ровных сотнях; mille никогда не меняется."],
      "requiredTokens": ["deux cents", "deux cent trois", "mille", "deux millions"],
      "objectiveIds": ["obj:l08c:agree-cent-mille"],
      "explanation": "Deux cents (ровно) vs deux cent trois (плюс единицы) — s то есть, то нет, в зависимости от того, идёт ли после сотни ещё число."
    },
    {
      "id": "l08c-e2",
      "type": "translate",
      "prompt": "Переведи, используя de: Город с миллионом жителей. Здание за миллиард долларов.",
      "acceptedAnswers": ["Une ville avec un million d'habitants. Un bâtiment à un milliard de dollars."],
      "modelAnswer": "Une ville avec un million d'habitants. Un bâtiment à un milliard de dollars.",
      "hints": ["Million и milliard — существительные, перед следующим словом нужен de (d' перед гласной)."],
      "requiredTokens": ["million d'habitants", "milliard de dollars"],
      "objectiveIds": ["obj:l08c:use-de-after-million-milliard"],
      "explanation": "Million/milliard ведут себя как обычные существительные (un kilo de...) — отсюда обязательный de."
    },
    {
      "id": "l08c-e3",
      "type": "reading-comprehension",
      "prompt": "Прочитай текст. Сколько жителей в городе и сколько это примерно в регионе?",
      "sourceText": "Cette ville compte environ trois cent mille habitants. Toute la région autour compte presque deux millions de personnes.",
      "acceptedAnswers": ["300 000 в городе, почти 2 миллиона в регионе", "trois cent mille habitants dans la ville, presque deux millions dans la région"],
      "modelAnswer": "В городе около трёхсот тысяч жителей, а во всём регионе — почти два миллиона человек.",
      "hints": ["Два числа в тексте: cent mille (сто тысяч) и millions."],
      "requiredTokens": [],
      "objectiveIds": ["obj:l08c:read-big-numbers"],
      "explanation": "Большие числа в реальных текстах часто округлены (environ, presque) — их тоже нужно уметь узнавать."
    }
  ],
  "cards": [
    {"id": "phrase:l08c:0", "front": "Сколько жителей в Париже?", "back": "Paris a combien d'habitants ?", "type": "phrase"},
    {"id": "phrase:l08c:1", "front": "В Париже около двух миллионов жителей.", "back": "Paris a environ deux millions d'habitants.", "type": "phrase"},
    {"id": "phrase:l08c:2", "front": "Plus de douze {{c1::millions}} de personnes.", "back": "Более двенадцати миллионов человек.", "type": "cloze"}
  ]
}
```

- [ ] **Step 3: Rewire `l09`'s prerequisite**

Find lesson `l09` ("Меню и цены"). Current:

```json
  "prerequisites": [
    "l08"
  ],
```

Change to:

```json
  "prerequisites": [
    "l08c"
  ],
```

- [ ] **Step 4: Update the two guardrail assertions in `tests/smoke.mjs`**

```js
assert.equal(data.lessons.length, 41, "The catalog grows to 41 lessons once l08c (numbers 100+) ships");
```

```js
assert.equal(exercises.length, 127, "41 lessons include 127 exercises with a seven-part checkpoint");
```

- [ ] **Step 5: Run the suite, confirm it passes**

Run: `node tests/smoke.mjs`
Expected: `Smoke tests passed: 41 lessons, 127 exercises, ...` and exit 0.

- [ ] **Step 6: Commit**

```bash
git add data/lessons.json tests/smoke.mjs
git commit -m "$(cat <<'EOF'
feat: add lesson l08c (numbers 100+) + numbers-large grammarTopic

Completes the numbers mini-module and rewires l09 (Menu et prix) to
require l08c instead of l08 directly, so the full 0-billion counting
block is a hard prerequisite for the prices lesson.
EOF
)"
```

---

### Task 4: Retire `l14`, fix `l15` and the `daily-services` module title

**Files:**
- Modify: `data/lessons.json` (`lessons[]`, `modules[]`)
- Modify: `tests/smoke.mjs:25,76`

**Interfaces:**
- Consumes: nothing from Tasks 1-3 (this is an independent cleanup of pre-existing content that the new module makes redundant).
- Produces: `l14` no longer exists; `l15` becomes the sole (first) lesson of `module:a1:daily-services`, chained directly to `l13`.

- [ ] **Step 1: Delete lesson `l14`**

In `data/lessons.json`, find the lesson object with `"id": "l14"` ("Числа и время: считаем и планируем") in the top-level `lessons` array and delete the entire object (including its trailing comma if it's not the last array element).

- [ ] **Step 2: Fix `l15`'s `order` and `prerequisites`**

Find lesson `l15` ("Часы работы: читаем и объясняем другу"). Current:

```json
  "moduleId": "module:a1:daily-services",
  "order": 2,
  "prerequisites": [
    "l14"
  ],
```

Change to:

```json
  "moduleId": "module:a1:daily-services",
  "order": 1,
  "prerequisites": [
    "l13"
  ],
```

- [ ] **Step 3: Rename the now-numbers-free module title**

Find the `module:a1:daily-services` object in the top-level `modules` array. Current:

```json
{
  "id": "module:a1:daily-services",
  "levelId": "a1",
  "title": "Числа, время и бытовые сервисы",
  "description": "Числа 0-100, il y a, чтение и объяснение объявлений/расписаний.",
  "order": 2,
  "prerequisites": [
    "module:a1:social-identity"
  ]
}
```

Change `title` and `description` (leave `order`/`prerequisites` untouched):

```json
{
  "id": "module:a1:daily-services",
  "levelId": "a1",
  "title": "Время и бытовые сервисы",
  "description": "Чтение и объяснение объявлений/расписаний с указанием времени.",
  "order": 2,
  "prerequisites": [
    "module:a1:social-identity"
  ]
}
```

- [ ] **Step 4: Update the two guardrail assertions in `tests/smoke.mjs`**

This is the final count — back down by one lesson (3 added in Tasks 1-3, 1 removed here) and by the 3 exercises `l14` used to contribute:

```js
assert.equal(data.lessons.length, 40, "The catalog contains 40 lessons after the numbers block replaces l14");
```

```js
assert.equal(exercises.length, 124, "40 lessons include 124 exercises with a seven-part checkpoint");
```

- [ ] **Step 5: Run the suite, confirm it passes**

Run: `node tests/smoke.mjs`
Expected: `Smoke tests passed: 40 lessons, 124 exercises, ...` and exit 0.

- [ ] **Step 6: Commit**

```bash
git add data/lessons.json tests/smoke.mjs
git commit -m "$(cat <<'EOF'
fix: retire l14 (superseded by the new numbers mini-module)

l14 only covered 0-100 and explicitly skipped 70-99 as "beyond
practical A1" — the new l08a/l08b/l08c block supersedes it with full
0-billion coverage. l15 becomes the first lesson of daily-services,
chained to l13 directly. The module title drops "Числа" since it no
longer introduces numbers, only uses them in l15's reading practice.

Two real review-history rows for l14's "onze" card in
user-data/french-study-data.json become harmless orphans — cards are
rebuilt from data/lessons.json at runtime (cards.js:buildCards), so
nothing crashes, the rows just stop surfacing. Accepted per the
approved design spec.
EOF
)"
```

---

### Task 5: Trim duplicate number vocabulary from `l13`

**Files:**
- Modify: `data/lessons.json` (`lessons[]`)

**Interfaces:**
- Consumes: nothing structural from earlier tasks — this is a content-quality fix enabled by Task 1 (l08a now teaches 0-20 as the canonical first exposure, earlier in the course than l13).
- Produces: no new ids, no count changes visible to `tests/smoke.mjs`'s guardrail assertions.

**Why this task exists:** `l13` ("Коротко о себе", in `module:a1:social-identity`, which now runs *after* the entire numbers module since `starter` fully precedes `a1`) currently has its own `vocabulary` entries for `zéro, un, deux, trois, quatre, cinq, dix, vingt` — the exact same French↔Russian pairs `l08a` now teaches. `cards.js:buildCards` does not deduplicate vocabulary cards against each other (only phrase cards get deduped against vocabulary via `cardSignature` — see `cards.js:41-44`), so leaving both in place would produce two separate, functionally-identical flashcards per number (e.g. two different `vocab:*:ru-fr` cards both asking "два" → "deux"). This wasn't part of the original design spec (only `l14` was) — it surfaced while drafting `l08a`'s content — but it directly serves the spec's "no true duplicate flashcards" principle already applied to `l14`, so it's folded into this plan rather than raised as a separate change.

- [ ] **Step 1: Remove the 8 plain-number vocabulary entries from `l13`**

Find lesson `l13` ("Коротко о себе"). Its `vocabulary` array currently starts:

```json
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
```

Delete entries `vocab:l13:0` through `vocab:l13:7` (the 8 plain numbers), keeping the ids of the remaining 3 entries exactly as-is (do not renumber them — `l13` has zero real SRS review history in `user-data/french-study-data.json`, but renumbering is unnecessary churn regardless). Result:

```json
  "vocabulary": [
    {"id": "vocab:l13:8", "fr": "un an / des ans", "ipa": "/ɛ̃.n‿ɑ̃/", "ru": "год (возраст)", "note": "J'ai vingt ans — дословно «я имею двадцать лет»."},
    {"id": "vocab:l13:9", "fr": "j'ai ... ans", "ipa": "/ʒe ... ɑ̃/", "ru": "мне ... лет", "note": "Возраст называют через avoir, не être."},
    {"id": "vocab:l13:10", "fr": "habiter à", "ipa": "/a.bi.te a/", "ru": "жить в (городе)", "note": "À перед названием города."}
  ],
```

Do not touch `l13`'s `dialogue`, `exercises`, or `cards` — the numbers still appear there (e.g. "J'ai vingt-cinq ans." in the dialogue and exercises), which is fine: dialogue-derived phrase cards are a different mechanism (whole sentences, not single-word vocab) and aren't affected by this trim.

- [ ] **Step 2: Run the suite, confirm it still passes**

Run: `node tests/smoke.mjs`
Expected: `Smoke tests passed: 40 lessons, 124 exercises, ...` and exit 0 (unchanged from Task 4 — this step only shrinks `l13.vocabulary`, which isn't counted by either guardrail assertion).

- [ ] **Step 3: Commit**

```bash
git add data/lessons.json
git commit -m "$(cat <<'EOF'
fix: drop l13's plain-number vocabulary now that l08a teaches 0-20

l13 (self-intro: age and city) ran through zéro-vingt as standalone
vocab entries before the numbers block existed. l08a now owns 0-20 as
the canonical first exposure, earlier in the course, so keeping the
same entries in l13 produced true duplicate flashcards (buildCards
does not dedupe vocabulary cards against each other). l13 keeps the
age/city-specific vocabulary (un an, j'ai...ans, habiter à) and its
dialogue/exercises are untouched.
EOF
)"
```

---

### Task 6: Update `README.md` lesson/exercise counts

**Files:**
- Modify: `README.md:5,47`

**Interfaces:**
- Consumes: final counts from Task 4 (40 lessons, 124 exercises).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Update the summary line**

`README.md:5` currently reads:

```
Текущий набор — **полный практический A1 для самостоятельной студенческой жизни**: 38 уроков, 118 упражнений, локальная запись устных заданий и финальный checkpoint по семи навыкам. Это не официальный сертификат CEFR/DELF; A2/B1/B2 остаются планом масштабирования в `courseRoadmap`.
```

Replace `38 уроков, 118 упражнений` with `40 уроков, 124 упражнения`.

- [ ] **Step 2: Update the file-listing line**

`README.md:47` currently reads:

```
- `data/lessons.json` - уроки (starter + практический A1, 38 уроков), грамматика, произношение, словарь, открытые ресурсы и roadmap A2-B2.
```

Replace `38 уроков` with `40 уроков`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: update lesson/exercise counts for the numbers block (38→40, 118→124)"
```

---

### Task 7: Prewarm and commit audio for the new lessons

**Files:**
- Create (generated): `data/audio/*.mp3` (new hash-named files for `l08a`/`l08b`/`l08c` text)
- Modify: `data/audio/manifest.json` (regenerated)

**Interfaces:**
- Consumes: the fully-authored `data/lessons.json` from Tasks 1-5 (`targetPhrase`, `dialogue[].fr`, `vocabulary[].fr`, `exercises[].listenText`/`transcript`, `cards[]` text — everything `scripts/prewarm_tts.py:collect_texts()` already walks).
- Produces: static, git-committed audio so the app doesn't fall back to a live TTS request for the new lessons' phrases — same guarantee the rest of the course has.

- [ ] **Step 1: Run the prewarm script**

```bash
.venv/bin/python scripts/prewarm_tts.py
```

Expected: prints one `Synthesizing: ...` line per new phrase text introduced by `l08a`/`l08b`/`l08c` (roughly 60-70 lines — 21+12+11 vocabulary items, 4 dialogue lines × 3 lessons, targetPhrases, exercise listen/transcript text, card text not already covered by dialogue), then `Prewarmed <N> phrases into .../data/audio using Edge TTS`. Requires network access and the `edge-tts` package (already in `requirements.txt` and the repo's `.venv`, per `README.md:10-12`). If `edge-tts` or network access isn't available in the execution environment, fall back to `.venv/bin/python scripts/prewarm_tts.py --local-macos` (uses the local macOS `say` voice + `ffmpeg`) — note this repo's commit history (`af428a2`) explicitly moved away from the macOS fallback for quality reasons, so prefer Edge TTS whenever possible and only use `--local-macos` if this task is genuinely blocked otherwise.

- [ ] **Step 2: Verify the manifest changed and no `l14`-only audio is silently broken**

```bash
git status --short data/audio
```

Expected: `data/audio/manifest.json` shows as modified, and a batch of new `data/audio/*.mp3` files show as untracked. `l14`'s old phrases (e.g. "Il y a combien de personnes ?") are still referenced by `l08a` with identical text, so their audio files remain in the manifest and are simply reused, not orphaned.

- [ ] **Step 3: Run the full test suite one more time**

```bash
node tests/smoke.mjs && node tests/exercises.mjs && node tests/card-manifest.mjs
```

Expected: all three exit 0 with no assertion errors.

- [ ] **Step 4: Commit**

```bash
git add data/audio
git commit -m "$(cat <<'EOF'
feat: prewarm audio for the numbers block (l08a/l08b/l08c)

Same process as every previous lesson batch: scripts/prewarm_tts.py
walks targetPhrase/dialogue/vocabulary/exercise listen-text/cards and
synthesizes anything not already cached by content hash.
EOF
)"
```

---

## Verification note (plan authoring, not an execution step)

Before writing this plan, every JSON block above was assembled with Python, written to disk, and dry-run through the *real* `course-validator.js` (`collectCourseValidationErrors`) and `cards.js` (`buildCards`) against a full copy of `data/lessons.json` with all edits applied — both the cumulative end state (Task 5) and each intermediate state (after Task 1, after Task 2, after Task 3, after Task 4). All five states validated with zero errors; lesson/exercise counts at each stage matched the numbers used in this plan's `tests/smoke.mjs` edits (39/121 → 40/124 → 41/127 → 40/124, final `l13` trim unchanged); `buildCards` produced 832 cards with zero duplicate ids on the final state. This means Tasks 1-5's JSON is not illustrative — it's the exact content to paste in, and each task's own `node tests/smoke.mjs` step is expected to pass on the first try.

## Boundaries (what this plan does not do)

- Does not touch `l01`-`l08` or `l16`-`l38` beyond the two edits in Task 4 (`l15`) — everything else in the existing 38-lesson catalog is untouched.
- Does not add ordinal numbers (premier, deuxième...) or clock-time telling (quelle heure est-il) — out of scope per the design spec (cardinal counting only).
- Does not change `app.js`, `cards.js`, `srs.js`, `mastery.js`, `course-validator.js`, or `course-schema.js` — the existing generic rendering/grading/scheduling engine handles the new content with zero code changes, same as every prior content-only plan in this repo.
- Does not delete `l14`'s now-orphaned audio files from `data/audio/` (they're content-hashed, not lesson-named, and mostly reused by `l08a`'s identical text — see Task 4's commit message and Task 7 Step 2).
