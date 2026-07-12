# Углубление справочника произношения и грамматики Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Обогатить каждую тему `pronunciationTopics[]`/`grammarTopics[]` в `data/lessons.json` тремя новыми обязательными блоками (`paradigm`, `commonMistakes`, `exceptions`), показать их на справочных страницах, и дать из урока ссылку «Подробнее →» на конкретную карточку темы.

**Architecture:** Схема (`course-schema.js`) и валидатор (`course-validator.js`) сначала поддерживают новые поля как опциональные (с проверкой формы, если поле присутствует) — это даёт безопасный путь наполнения контента без долгого «красного» состояния тестов. После того как весь контент написан, поля становятся обязательными одним финальным переключением схемы. Рендер (`app.js`) показывает новые блоки только на страницах-справочниках; внутри урока остаётся компактная версия + ссылка, которая переключает вкладку и скроллит к нужной карточке.

**Tech Stack:** Vanilla JS (ES-модули, без сборки), JSON-каталог, Node.js для тестов (`node tests/*.mjs`), Python `http.server`-based `server.py` для локального запуска.

## Global Constraints

- Спецификация: [docs/superpowers/specs/2026-07-10-reference-topics-depth-design.md](../specs/2026-07-10-reference-topics-depth-design.md).
- Новые поля `paradigm: [{label, form}]`, `commonMistakes: [{wrong, right, note}]`, `exceptions: [{wrong, right, note}]` — обязательны и непусты для КАЖДОЙ из 5 тем произношения и 21 темы грамматики.
- Новые блоки показываются только на справочных страницах («Звуки и правила чтения», «Грамматика как справочник»); внутри урока — компактная версия (без изменений в объёме) + ссылка «Подробнее →».
- `COURSE_SCHEMA_VERSION` переходит с 2 на 3; `data/lessons.json`'s `meta.catalogSchemaVersion` обновляется синхронно.
- Никаких внешних зависимостей/сборки не добавляется — проект остаётся vanilla JS + Python-сервер.
- После каждой задачи, где меняется `data/lessons.json` или валидатор, запускать `node tests/smoke.mjs` (использует `validateCourseCatalog`/`collectCourseValidationErrors` на реальных данных).

---

### Task 1: Схема и валидатор — опциональная поддержка paradigm/commonMistakes/exceptions

**Files:**
- Modify: `course-schema.js:67-74`
- Modify: `course-validator.js:89-103`, `course-validator.js:419-428` (после `validateTextArray`)
- Test: `tests/smoke.mjs` (добавить блок ассертов)

**Interfaces:**
- Produces: `COURSE_SCHEMA.paradigmEntry` (`{requiredText: ["label", "form"]}`), `COURSE_SCHEMA.mistakeEntry` (`{requiredText: ["wrong", "right", "note"]}`); `validateStructuredArray(value, path, itemSchema, errors, { nonEmpty })` в `course-validator.js` — используется задачами 7-10 не понадобится напрямую, но её вызовы внутри `pronunciationTopics`/`grammarTopics` циклов используются с задачи 2 (наполнение контента будет валидироваться этим кодом).

- [ ] **Step 1: Написать падающий тест в `tests/smoke.mjs`**

Открой `tests/smoke.mjs`, найди блок:
```js
const validBackup = {
  format: "french-study-backup",
  version: 1,
  stores: Object.fromEntries(STORE_NAMES.map((name) => [name, []]))
};
assert.equal(validateBackup(validBackup), true);
assert.throws(() => validateBackup({ format: "wrong", version: 1, stores: {} }));

console.log(`Smoke tests passed: ${data.lessons.length} lessons, ${exercises.length} exercises, ${cards.length} cards.`);
```

Вставь новый блок между `assert.throws(...)` и `console.log(...)`:
```js
const malformedParadigmCatalog = JSON.parse(JSON.stringify(data));
malformedParadigmCatalog.pronunciationTopics[0].paradigm = [{ label: "начало слова" }];
const paradigmErrors = collectCourseValidationErrors(malformedParadigmCatalog);
assert.ok(
  paradigmErrors.some((error) => error.includes("pronunciationTopics[0].paradigm[0].form")),
  "Malformed paradigm entry (missing form) must be reported"
);

const malformedMistakeCatalog = JSON.parse(JSON.stringify(data));
malformedMistakeCatalog.grammarTopics[0].commonMistakes = [{ wrong: "x", right: "y" }];
const mistakeErrors = collectCourseValidationErrors(malformedMistakeCatalog);
assert.ok(
  mistakeErrors.some((error) => error.includes("grammarTopics[0].commonMistakes[0].note")),
  "Malformed commonMistakes entry (missing note) must be reported"
);

const emptyParadigmCatalog = JSON.parse(JSON.stringify(data));
emptyParadigmCatalog.grammarTopics[0].paradigm = [];
const emptyErrors = collectCourseValidationErrors(emptyParadigmCatalog);
assert.ok(
  emptyErrors.some((error) => error.includes("grammarTopics[0].paradigm: expected at least one item")),
  "Empty paradigm array must be reported"
);

const wellFormedCatalog = JSON.parse(JSON.stringify(data));
wellFormedCatalog.pronunciationTopics[0].paradigm = [{ label: "начало слова", form: "rue" }];
wellFormedCatalog.pronunciationTopics[0].commonMistakes = [{ wrong: "x", right: "y", note: "z" }];
wellFormedCatalog.pronunciationTopics[0].exceptions = [{ wrong: "x", right: "y", note: "z" }];
const wellFormedErrors = collectCourseValidationErrors(wellFormedCatalog);
assert.ok(
  !wellFormedErrors.some((error) => error.startsWith("pronunciationTopics[0].paradigm"))
    && !wellFormedErrors.some((error) => error.startsWith("pronunciationTopics[0].commonMistakes"))
    && !wellFormedErrors.some((error) => error.startsWith("pronunciationTopics[0].exceptions")),
  "Well-formed paradigm/commonMistakes/exceptions must not raise errors"
);
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `node tests/smoke.mjs`
Expected: `AssertionError` на первом новом assert (`"Malformed paradigm entry..."`) — валидатор пока не проверяет форму `paradigm`.

- [ ] **Step 3: Добавить схемы `paradigmEntry`/`mistakeEntry` в `course-schema.js`**

В `course-schema.js:67-74` найди:
```js
  pronunciationTopic: Object.freeze({
    requiredText: Object.freeze(["id", "title", "level", "target", "cue"]),
    requiredArrays: Object.freeze(["minimalPairs"])
  }),
  grammarTopic: Object.freeze({
    requiredText: Object.freeze(["id", "title", "level", "rule"]),
    requiredArrays: Object.freeze(["examples"])
  }),
```
Оставь этот блок БЕЗ ИЗМЕНЕНИЙ (поля станут обязательными только в задаче 7) и добавь сразу после него (перед `lesson: Object.freeze({`):
```js
  paradigmEntry: Object.freeze({
    requiredText: Object.freeze(["label", "form"])
  }),
  mistakeEntry: Object.freeze({
    requiredText: Object.freeze(["wrong", "right", "note"])
  }),
```

- [ ] **Step 4: Добавить `validateStructuredArray` и вызовы в `course-validator.js`**

В `course-validator.js:419-428` найди функцию `validateTextArray`:
```js
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
```
Сразу после неё добавь новую функцию:
```js
function validateStructuredArray(value, path, itemSchema, errors, { nonEmpty = false } = {}) {
  if (!Array.isArray(value)) return;
  if (nonEmpty && value.length === 0) errors.push(`${path}: expected at least one item`);
  value.forEach((item, index) => {
    validateObject(item, `${path}[${index}]`, itemSchema, errors);
  });
}
```

Теперь в `course-validator.js:89-103` найди:
```js
  pronunciationTopics.forEach((topic, index) => {
    const path = `pronunciationTopics[${index}]`;
    validateObject(topic, path, COURSE_SCHEMA.pronunciationTopic, errors);
    validateLevel(topic?.level, `${path}.level`, errors);
    registerId(topic?.id, `${path}.id`, pronunciationIds, errors);
    validateTextArray(topic?.minimalPairs, `${path}.minimalPairs`, errors, { nonEmpty: true });
  });

  grammarTopics.forEach((topic, index) => {
    const path = `grammarTopics[${index}]`;
    validateObject(topic, path, COURSE_SCHEMA.grammarTopic, errors);
    validateLevel(topic?.level, `${path}.level`, errors);
    registerId(topic?.id, `${path}.id`, grammarIds, errors);
    validateTextArray(topic?.examples, `${path}.examples`, errors, { nonEmpty: true });
  });
```
Замени на:
```js
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
```

- [ ] **Step 5: Убедиться, что тест проходит**

Run: `node tests/smoke.mjs`
Expected: `Smoke tests passed: 38 lessons, ... .` — без ошибок.

- [ ] **Step 6: Commit**

```bash
git add course-schema.js course-validator.js tests/smoke.mjs
git commit -m "feat: validate optional paradigm/commonMistakes/exceptions on reference topics"
```

---

### Task 2: Контент — 5 тем произношения

**Files:**
- Modify: `data/lessons.json:520-560` (массив `pronunciationTopics`)

**Interfaces:**
- Consumes: ничего нового — использует существующие поля `id`/`title`/`level`/`target`/`cue`/`minimalPairs` как якорь для точного `old_string`.
- Produces: у всех 5 тем произношения появляются непустые `paradigm`, `commonMistakes`, `exceptions` — с этого момента `node tests/smoke.mjs` дополнительно проверяет их форму (задача 1).

- [ ] **Step 1: Заменить массив `pronunciationTopics` целиком**

В `data/lessons.json` найди блок (начинается с `"pronunciationTopics": [` и заканчивается перед `"grammarTopics": [`):
```json
  "pronunciationTopics": [
    {
      "id": "u-y",
      "title": "Французский u /y/",
      "level": "A0",
      "target": "tu, une, russe, salut",
      "cue": "Скажи русское 'и', оставь язык на месте и округли губы как для 'у'.",
      "minimalPairs": ["tu / tout", "rue / roue", "su / sous"]
    },
    {
      "id": "nasals",
      "title": "Носовые гласные",
      "level": "A1",
      "target": "un bon vin blanc",
      "cue": "Не добавляй русское 'н' в конце. Гласная звучит через рот и нос одновременно.",
      "minimalPairs": ["pain / pan / pont", "vin / vent / vont", "bon / beau"]
    },
    {
      "id": "r",
      "title": "Французское r /ʁ/",
      "level": "A1",
      "target": "bonjour, merci, très, rue",
      "cue": "Звук рождается глубже, чем русское 'р'. Цель - понятность, не идеальная театральность.",
      "minimalPairs": ["roue / vous", "rue / vue", "rat / tas"]
    },
    {
      "id": "liaison",
      "title": "Liaison и enchaînement",
      "level": "A1",
      "target": "vous avez, les amis, un étudiant",
      "cue": "Некоторые конечные согласные оживают перед гласной и связывают слова в одну фразу.",
      "minimalPairs": ["vous avez / vous parlez", "les amis / les livres", "un étudiant / un professeur"]
    },
    {
      "id": "silent-endings",
      "title": "Немые окончания",
      "level": "A1",
      "target": "parlez, petit, grand, beaucoup",
      "cue": "Финальные согласные часто не звучат. Сначала учим слово как звук, затем как написание.",
      "minimalPairs": ["petit / petite", "grand / grande", "parle / parlez"]
    }
  ],
```
Замени на:
```json
  "pronunciationTopics": [
    {
      "id": "u-y",
      "title": "Французский u /y/",
      "level": "A0",
      "target": "tu, une, russe, salut",
      "cue": "Скажи русское 'и', оставь язык на месте и округли губы как для 'у'.",
      "minimalPairs": ["tu / tout", "rue / roue", "su / sous"],
      "paradigm": [
        { "label": "в начале слова", "form": "usine [yzin]" },
        { "label": "в середине слова", "form": "musique [myzik]" },
        { "label": "в конце слова", "form": "vu [vy]" },
        { "label": "после согласной группы", "form": "plus [ply]" }
      ],
      "commonMistakes": [
        { "wrong": "tu произносится с русским «у»: [tu]", "right": "tu → [ty], округли губы, но язык держи как для «и»", "note": "Русское «у» — губы и язык вместе назад; французское u — язык вперёд, только губы округлены" },
        { "wrong": "russe произносится с русским «у»: [rus]", "right": "russe → [ʁys]", "note": "Тот же звук /y/, что и в tu — не путай с ou [u]" }
      ],
      "exceptions": [
        { "wrong": "буквосочетание ou тоже читается как u [y]", "right": "ou читается как [u] (русское «у»): vous [vu]", "note": "Буквосочетание ou — это другой звук [u], не путать с одиночной буквой u [y]" }
      ]
    },
    {
      "id": "nasals",
      "title": "Носовые гласные",
      "level": "A1",
      "target": "un bon vin blanc",
      "cue": "Не добавляй русское 'н' в конце. Гласная звучит через рот и нос одновременно.",
      "minimalPairs": ["pain / pan / pont", "vin / vent / vont", "bon / beau"],
      "paradigm": [
        { "label": "in / im / ain / ein → [ɛ̃]", "form": "vin, important, pain, plein" },
        { "label": "on / om → [ɔ̃]", "form": "bon, nom" },
        { "label": "an / am / en / em → [ɑ̃]", "form": "blanc, chambre, temps" },
        { "label": "un / um → [œ̃]", "form": "un, parfum" }
      ],
      "commonMistakes": [
        { "wrong": "добавляешь русское «н» в конце: bon → [бон]", "right": "bon → [bɔ̃], без отдельного звука «н»", "note": "Носовая гласная — это один гласный звук, произнесённый через нос, а не гласная плюс согласная н" },
        { "wrong": "vin и vent произносятся одинаково", "right": "vin [vɛ̃] отличается от vent [vɑ̃]", "note": "Три разных носовых гласных легко спутать на слух — тренируй пары pain/pan/pont" }
      ],
      "exceptions": [
        { "wrong": "перед удвоенной n/m гласная тоже носовая", "right": "bonne [bɔn] — не носовая, потому что после n идёт ещё одна гласная", "note": "n/m назализует предыдущую гласную только на конце слога; перед гласной или удвоенной согласной звук становится обычным (устным)" }
      ]
    },
    {
      "id": "r",
      "title": "Французское r /ʁ/",
      "level": "A1",
      "target": "bonjour, merci, très, rue",
      "cue": "Звук рождается глубже, чем русское 'р'. Цель - понятность, не идеальная театральность.",
      "minimalPairs": ["roue / vous", "rue / vue", "rat / tas"],
      "paradigm": [
        { "label": "в начале слова", "form": "rue [ʁy]" },
        { "label": "в середине слова", "form": "merci [mɛʁsi]" },
        { "label": "в конце слова", "form": "bonjour [bɔ̃ʒuʁ]" },
        { "label": "в группе согласных", "form": "très [tʁɛ]" }
      ],
      "commonMistakes": [
        { "wrong": "произносишь r как русское раскатистое «р» кончиком языка", "right": "французское r звучит в глубине горла, кончик языка остаётся внизу", "note": "Цель — понятность, а не идеальный горловой звук: слишком резкое «р» тоже звучит как акцент" },
        { "wrong": "проглатываешь r в конце слова совсем", "right": "bonjour — r в конце слышен, просто мягче", "note": "В отличие от многих финальных согласных, конечное r в односложных и части других слов обычно произносится" }
      ],
      "exceptions": [
        { "wrong": "в окончании -er глаголов r произносится так же чётко", "right": "parler → [paʁle], конечное r в инфинитивах на -er не звучит вовсе", "note": "Глагольное окончание -er — одно из немых окончаний, см. тему silent-endings" }
      ]
    },
    {
      "id": "liaison",
      "title": "Liaison и enchaînement",
      "level": "A1",
      "target": "vous avez, les amis, un étudiant",
      "cue": "Некоторые конечные согласные оживают перед гласной и связывают слова в одну фразу.",
      "minimalPairs": ["vous avez / vous parlez", "les amis / les livres", "un étudiant / un professeur"],
      "paradigm": [
        { "label": "vous + гласная", "form": "vous avez [vu.za.ve]" },
        { "label": "les + гласная", "form": "les amis [le.za.mi]" },
        { "label": "un + гласная", "form": "un étudiant [œ̃.ne.ty.djɑ̃]" },
        { "label": "est + гласная", "form": "il est ici [i.lɛ.ti.si]" }
      ],
      "commonMistakes": [
        { "wrong": "делаешь паузу между словами: vous / avez", "right": "vous_avez произносится слитно, s звучит как [z]", "note": "Без liaison фраза звучит рублено и непонятно на слух для носителя" },
        { "wrong": "делаешь liaison перед любым словом подряд", "right": "liaison — только перед словом, начинающимся с гласной или немого h", "note": "Перед согласной liaison не делается: vous parlez без связки" }
      ],
      "exceptions": [
        { "wrong": "h всегда блокирует liaison, как согласная", "right": "перед h aspiré liaison не делается: les / haricots, а перед h muet — делается: les_hommes", "note": "На письме оба h выглядят одинаково, различие нужно запоминать по словарю" }
      ]
    },
    {
      "id": "silent-endings",
      "title": "Немые окончания",
      "level": "A1",
      "target": "parlez, petit, grand, beaucoup",
      "cue": "Финальные согласные часто не звучат. Сначала учим слово как звук, затем как написание.",
      "minimalPairs": ["petit / petite", "grand / grande", "parle / parlez"],
      "paradigm": [
        { "label": "-e не звучит", "form": "petite [pətit] (е немое в конце)" },
        { "label": "-s / -t / -d не звучат", "form": "grand [gʁɑ̃], petit [pəti]" },
        { "label": "-ez / -er глагольные не звучат как [z]/[r]", "form": "parlez [paʁle]" },
        { "label": "-p / -x на конце обычно немые", "form": "beaucoup [boku]" }
      ],
      "commonMistakes": [
        { "wrong": "произносишь все буквы, как написано: grand → [гранд]", "right": "grand → [gʁɑ̃], d не звучит", "note": "Французское письмо и произношение сильно расходятся — учи слово по звуку, потом сверяй с написанием" },
        { "wrong": "parlez произносится со звучным z в конце: [paʁlez]", "right": "parlez → [paʁle], конечное z из -ez не читается", "note": "Окончание -ez — графический знак второго лица множественного числа, звука [z] в нём нет" }
      ],
      "exceptions": [
        { "wrong": "финальные согласные всегда немые", "right": "в словах вроде sac [sak] или avec [avɛk] конечная согласная звучит", "note": "Правило действует не для всех согласных: c, f, l, r часто произносятся на конце слова (мнемоника CaReFul)" }
      ]
    }
  ],
```

- [ ] **Step 2: Проверить**

Run: `node tests/smoke.mjs`
Expected: `Smoke tests passed: 38 lessons, ... .` — без ошибок (новые массивы валидны по форме).

- [ ] **Step 3: Commit**

```bash
git add data/lessons.json
git commit -m "content: add paradigm/commonMistakes/exceptions to pronunciation topics"
```

---

### Task 3: Контент — грамматика, батч 1 (fixed-phrases, etre, articles, questions, voudrais, near-future)

**Files:**
- Modify: `data/lessons.json` (первые 6 объектов массива `grammarTopics`)

- [ ] **Step 1: Заменить первые 6 тем грамматики**

Найди блок (начало массива `grammarTopics`, до темы `needs-negation`):
```json
  "grammarTopics": [
    {
      "id": "fixed-phrases",
      "title": "Готовые разговорные формулы",
      "level": "A0",
      "rule": "На старте Bonjour, Merci и Au revoir учатся целиком. Не нужно разбирать каждое слово, чтобы сразу использовать фразу.",
      "examples": ["Bonjour !", "Merci.", "Au revoir."]
    },
    {
      "id": "etre",
      "title": "Être: быть",
      "level": "A1",
      "rule": "Je suis, tu es, il/elle est, vous êtes нужны для представления и описания себя.",
      "examples": ["Je suis André.", "Tu es étudiant ?", "Vous êtes russe ?"]
    },
    {
      "id": "articles",
      "title": "Артикли un / une / le / la",
      "level": "A1",
      "rule": "Во французском существительное почти всегда живет с артиклем. Род лучше учить вместе со словом.",
      "examples": ["un café", "une table", "le métro", "la rue"]
    },
    {
      "id": "questions",
      "title": "Разговорные и формальные вопросы",
      "level": "A1",
      "rule": "В разговоре вопрос можно задать интонацией, нейтрально — через est-ce que, а в формальной речи — с инверсией глагола и местоимения.",
      "examples": ["Vous avez un café ?", "Est-ce que tu parles français ?", "Comment vous appelez-vous ?"]
    },
    {
      "id": "voudrais",
      "title": "Je voudrais",
      "level": "A1",
      "rule": "Je voudrais - вежливый способ попросить что-то. На старте это важнее полной таблицы conditionnel.",
      "examples": ["Je voudrais un café.", "Je voudrais payer.", "Je voudrais aller au centre."]
    },
    {
      "id": "near-future",
      "title": "Ближайшее будущее: aller + infinitif",
      "level": "A1",
      "rule": "Je vais + infinitif говорит о ближайшем плане: я собираюсь что-то сделать.",
      "examples": ["Je vais travailler.", "Nous allons manger.", "Vous allez partir ?"]
    },
```
Замени на:
```json
  "grammarTopics": [
    {
      "id": "fixed-phrases",
      "title": "Готовые разговорные формулы",
      "level": "A0",
      "rule": "На старте Bonjour, Merci и Au revoir учатся целиком. Не нужно разбирать каждое слово, чтобы сразу использовать фразу.",
      "examples": ["Bonjour !", "Merci.", "Au revoir."],
      "paradigm": [
        { "label": "нейтрально/формально", "form": "Bonjour, merci, au revoir" },
        { "label": "неформально, с друзьями", "form": "Salut, merci, à bientôt" },
        { "label": "прощание вечером", "form": "Bonsoir → Bonne soirée" }
      ],
      "commonMistakes": [
        { "wrong": "используешь Salut в формальной ситуации (магазин, офис)", "right": "Bonjour подходит везде, Salut — только с друзьями и ровесниками", "note": "Неверный регистр речи звучит невежливо даже при правильной грамматике" },
        { "wrong": "не здороваешься первым делом, сразу переходишь к просьбе", "right": "Bonjour всегда идёт первой репликой, даже перед вопросом", "note": "Во французской культуре обращение без Bonjour воспринимается как грубость" }
      ],
      "exceptions": [
        { "wrong": "Bonjour используется в любое время суток", "right": "вечером естественнее Bonsoir, а не Bonjour", "note": "Формально это не грамматическое правило, а социальная норма — но её тоже нужно выучить целиком, как фразу" }
      ]
    },
    {
      "id": "etre",
      "title": "Être: быть",
      "level": "A1",
      "rule": "Je suis, tu es, il/elle est, vous êtes нужны для представления и описания себя.",
      "examples": ["Je suis André.", "Tu es étudiant ?", "Vous êtes russe ?"],
      "paradigm": [
        { "label": "je", "form": "je suis" },
        { "label": "tu", "form": "tu es" },
        { "label": "il / elle / on", "form": "il est" },
        { "label": "nous", "form": "nous sommes" },
        { "label": "vous", "form": "vous êtes" },
        { "label": "ils / elles", "form": "ils sont" }
      ],
      "commonMistakes": [
        { "wrong": "je suis произносится с растянутым и, как отдельное слово", "right": "je suis → [ʒə sɥi], suis звучит коротко, почти слитно с je", "note": "Быстрое, слитное произношение — не отдельная растяжка звуков" },
        { "wrong": "vous êtes используешь только для множественного числа", "right": "vous êtes — это и вежливое «вы» к одному человеку, и обращение к нескольким", "note": "Vous — вежливая форма единственного числа тоже, не только множественное" }
      ],
      "exceptions": [
        { "wrong": "être спрягается регулярно, как обычный -re глагол", "right": "être — полностью неправильный глагол, формы нужно просто выучить целиком", "note": "В отличие от regular -er/-ir/-re глаголов, тут нет предсказуемой основы" }
      ]
    },
    {
      "id": "articles",
      "title": "Артикли un / une / le / la",
      "level": "A1",
      "rule": "Во французском существительное почти всегда живет с артиклем. Род лучше учить вместе со словом.",
      "examples": ["un café", "une table", "le métro", "la rue"],
      "paradigm": [
        { "label": "неопределённый, м.р.", "form": "un café" },
        { "label": "неопределённый, ж.р.", "form": "une table" },
        { "label": "определённый, м.р.", "form": "le métro" },
        { "label": "определённый, ж.р.", "form": "la rue" },
        { "label": "определённый перед гласной (оба рода)", "form": "l'ami / l'école" }
      ],
      "commonMistakes": [
        { "wrong": "существительное используется без артикля: je voudrais café", "right": "je voudrais un café — артикль почти всегда обязателен", "note": "В русском артиклей нет, поэтому их пропуск — самая частая ошибка русскоговорящих" },
        { "wrong": "род угадывается по смыслу слова", "right": "род нужно запоминать вместе со словом: une table, а не логикой", "note": "Грамматический род во французском часто не связан с реальным полом/смыслом предмета" }
      ],
      "exceptions": [
        { "wrong": "перед гласной всегда остаётся le/la", "right": "le/la сокращаются до l' перед гласной или немым h: l'école, l'homme", "note": "Это фонетическое исключение — сделано, чтобы избежать зияния двух гласных подряд" }
      ]
    },
    {
      "id": "questions",
      "title": "Разговорные и формальные вопросы",
      "level": "A1",
      "rule": "В разговоре вопрос можно задать интонацией, нейтрально — через est-ce que, а в формальной речи — с инверсией глагола и местоимения.",
      "examples": ["Vous avez un café ?", "Est-ce que tu parles français ?", "Comment vous appelez-vous ?"],
      "paradigm": [
        { "label": "разговорный (интонация)", "form": "Vous avez un café ?" },
        { "label": "нейтральный (est-ce que)", "form": "Est-ce que tu parles français ?" },
        { "label": "формальный (инверсия)", "form": "Comment vous appelez-vous ?" }
      ],
      "commonMistakes": [
        { "wrong": "используешь инверсию в разговорной речи с друзьями", "right": "в устной неформальной речи проще: Tu parles français ? (просто интонация вверх)", "note": "Инверсия звучит книжно/официально в бытовом разговоре" },
        { "wrong": "разбираешь est-ce que на отдельные слова и переспрашиваешь ими", "right": "Est-ce que — цельная неразложимая частица перед утвердительным порядком слов", "note": "Не пытайся анализировать её по частям — просто ставится в начало фразы" }
      ],
      "exceptions": [
        { "wrong": "инверсия всегда простая: глагол-подлежащее", "right": "с il/elle перед гласной вставляется -t-: Parle-t-il français ?", "note": "Вставное -t- нужно для благозвучия между двумя гласными на стыке глагола и местоимения" }
      ]
    },
    {
      "id": "voudrais",
      "title": "Je voudrais",
      "level": "A1",
      "rule": "Je voudrais - вежливый способ попросить что-то. На старте это важнее полной таблицы conditionnel.",
      "examples": ["Je voudrais un café.", "Je voudrais payer.", "Je voudrais aller au centre."],
      "paradigm": [
        { "label": "je", "form": "je voudrais" },
        { "label": "tu", "form": "tu voudrais" },
        { "label": "vous (вежливо)", "form": "vous voudriez" },
        { "label": "nous", "form": "nous voudrions" }
      ],
      "commonMistakes": [
        { "wrong": "используешь je veux вместо je voudrais в просьбе к незнакомым", "right": "je voudrais вежливее je veux — стандарт в магазине/кафе", "note": "Je veux звучит слишком прямо, почти как требование" },
        { "wrong": "после je voudrais ставишь de перед существительным: je voudrais de un café", "right": "je voudrais un café — прямое дополнение без de", "note": "De появляется только в отрицании: je ne voudrais pas de café" }
      ],
      "exceptions": [
        { "wrong": "voudrais — обычная форма настоящего времени", "right": "voudrais — форма conditionnel от vouloir, используется как готовая вежливая формула", "note": "На старте формулу учат целиком, не разбирая условное наклонение — оно ещё не пройдено" }
      ]
    },
    {
      "id": "near-future",
      "title": "Ближайшее будущее: aller + infinitif",
      "level": "A1",
      "rule": "Je vais + infinitif говорит о ближайшем плане: я собираюсь что-то сделать.",
      "examples": ["Je vais travailler.", "Nous allons manger.", "Vous allez partir ?"],
      "paradigm": [
        { "label": "je", "form": "je vais travailler" },
        { "label": "tu", "form": "tu vas travailler" },
        { "label": "il / elle / on", "form": "il va travailler" },
        { "label": "nous", "form": "nous allons manger" },
        { "label": "vous", "form": "vous allez partir" },
        { "label": "ils / elles", "form": "ils vont manger" }
      ],
      "commonMistakes": [
        { "wrong": "после aller используешь спрягаемый глагол: je vais je travaille", "right": "после aller всегда инфинитив: je vais travailler", "note": "Конструкция — вспомогательный глагол aller + неизменяемый инфинитив смыслового глагола" },
        { "wrong": "путаешь vais/vas/va на слух — кажется, все звучат одинаково", "right": "vais [vɛ], vas/va [va] — vas и va произносятся одинаково, различаются по подлежащему", "note": "На слух ориентируйся на местоимение перед формой, не только на саму форму" }
      ],
      "exceptions": [
        { "wrong": "aller всегда указывает на будущее время", "right": "je vais à Paris — тот же глагол aller как самостоятельный, означает движение, а не будущее", "note": "Будущее образуется только когда после aller идёт инфинитив другого глагола" }
      ]
    },
```

- [ ] **Step 2: Проверить**

Run: `node tests/smoke.mjs`
Expected: `Smoke tests passed: 38 lessons, ... .` — без ошибок.

- [ ] **Step 3: Commit**

```bash
git add data/lessons.json
git commit -m "content: add paradigm/commonMistakes/exceptions to grammar topics batch 1"
```

---

### Task 4: Контент — грамматика, батч 2 (needs-negation, prices-hours, announcements, avoir, il-y-a)

**Files:**
- Modify: `data/lessons.json` (темы `needs-negation` … `il-y-a`)

- [ ] **Step 1: Заменить блок**

Найди:
```json
    {
      "id": "needs-negation",
      "title": "Потребность и отрицание",
      "level": "A1",
      "rule": "J'ai besoin de + существительное выражает потребность; de становится d' перед гласной. В полном отрицании ne и pas окружают спрягаемый глагол.",
      "examples": ["J'ai besoin d'aide.", "J'ai besoin d'une carte.", "Je ne comprends pas."]
    },
    {
      "id": "prices-hours",
      "title": "Цены и часы работы",
      "level": "A1",
      "rule": "Combien ça coûte ? спрашивает цену. Для часов работы часто используется ouvert de ... à ...",
      "examples": ["Combien ça coûte ?", "Le café est ouvert de huit heures à midi.", "Ça coûte trois euros."]
    },
    {
      "id": "announcements",
      "title": "Короткие объявления",
      "level": "A1",
      "rule": "В объявлениях важны ключевые слова: кто/что, место, время. Сначала ловим смысл, потом проверяем транскрипт.",
      "examples": ["Le train part à dix heures.", "Le train est quai deux.", "Attention, le magasin est fermé."]
    },
    {
      "id": "avoir",
      "title": "Avoir: иметь",
      "level": "A1",
      "rule": "J'ai, tu as, il/elle a, nous avons, vous avez, ils/elles ont. Avoir нужен не только для обладания, но и для возраста (j'ai ... ans) и устойчивых конструкций (avoir besoin de, avoir faim).",
      "examples": ["J'ai vingt-cinq ans.", "Tu as une minute ?", "Nous avons une pause à midi."]
    },
    {
      "id": "il-y-a",
      "title": "Il y a: есть, имеется",
      "level": "A1",
      "rule": "Il y a не меняется по числам и родам: одна форма для 'есть один стул' и 'есть двадцать стульев'. Отрицание — il n'y a pas de.",
      "examples": ["Il y a dix personnes.", "Il y a vingt chaises.", "Il n'y a pas de café."]
    },
```
Замени на:
```json
    {
      "id": "needs-negation",
      "title": "Потребность и отрицание",
      "level": "A1",
      "rule": "J'ai besoin de + существительное выражает потребность; de становится d' перед гласной. В полном отрицании ne и pas окружают спрягаемый глагол.",
      "examples": ["J'ai besoin d'aide.", "J'ai besoin d'une carte.", "Je ne comprends pas."],
      "paradigm": [
        { "label": "перед согласной", "form": "j'ai besoin de temps" },
        { "label": "перед гласной", "form": "j'ai besoin d'aide" },
        { "label": "полное отрицание", "form": "je ne comprends pas" },
        { "label": "отрицание в разговорной речи (ne опускается)", "form": "je comprends pas" }
      ],
      "commonMistakes": [
        { "wrong": "оставляешь de перед гласной: besoin de aide", "right": "de сокращается до d' перед гласной: besoin d'aide", "note": "Как и артикль le/la, служебное de теряет e перед гласным звуком" },
        { "wrong": "используешь только pas без ne на письме", "right": "в письменной и нейтральной устной речи нужны обе части: ne ... pas", "note": "Опущение ne — только разговорная норма устной речи, не для писем/упражнений" }
      ],
      "exceptions": [
        { "wrong": "ne...pas всегда окружает один глагол одинаково", "right": "с инфинитивом обе частицы встают перед ним: ne pas comprendre (не ne comprendre pas)", "note": "Порядок ne pas + infinitif отличается от отрицания спрягаемого глагола" }
      ]
    },
    {
      "id": "prices-hours",
      "title": "Цены и часы работы",
      "level": "A1",
      "rule": "Combien ça coûte ? спрашивает цену. Для часов работы часто используется ouvert de ... à ...",
      "examples": ["Combien ça coûte ?", "Le café est ouvert de huit heures à midi.", "Ça coûte trois euros."],
      "paradigm": [
        { "label": "вопрос о цене", "form": "Combien ça coûte ?" },
        { "label": "ответ о цене", "form": "Ça coûte trois euros" },
        { "label": "часы работы (диапазон)", "form": "ouvert de huit heures à midi" },
        { "label": "закрыто", "form": "fermé le dimanche" }
      ],
      "commonMistakes": [
        { "wrong": "спрашиваешь цену без ça перед глаголом: Combien coûte ?", "right": "Combien ça coûte ? — ça стоит перед глаголом", "note": "В разговорной конструкции подлежащее ça идёт перед coûte, а combien — вопросительное слово впереди" },
        { "wrong": "используешь heure и во множественном числе после цифры: à deux heure", "right": "после цифры больше одного всегда heures: à deux heures", "note": "Une heure — один час, но с любым другим числом — heures во множественном" }
      ],
      "exceptions": [
        { "wrong": "midi считается как douze heures", "right": "полдень — отдельное слово midi, а не douze heures", "note": "Аналогично minuit (полночь) — оба слова заменяют собой 12 heures в быту" }
      ]
    },
    {
      "id": "announcements",
      "title": "Короткие объявления",
      "level": "A1",
      "rule": "В объявлениях важны ключевые слова: кто/что, место, время. Сначала ловим смысл, потом проверяем транскрипт.",
      "examples": ["Le train part à dix heures.", "Le train est quai deux.", "Attention, le magasin est fermé."],
      "paradigm": [
        { "label": "объявление о рейсе/поезде", "form": "Le train part à dix heures" },
        { "label": "место", "form": "Le train est quai deux" },
        { "label": "предупреждение", "form": "Attention, le magasin est fermé" }
      ],
      "commonMistakes": [
        { "wrong": "пытаешься понять каждое слово объявления сразу", "right": "сначала слушай ключевые слова: кто/что, место, время — детали потом", "note": "В объявлениях речь быстрая и с фоновым шумом, стратегия — сначала общий смысл" },
        { "wrong": "не различаешь quai (платформа) и voie (путь)", "right": "quai — платформа, где стоишь; voie — номер пути поезда", "note": "В реальных объявлениях оба слова встречаются и означают разное" }
      ],
      "exceptions": [
        { "wrong": "все объявления строятся по одной и той же формуле", "right": "формулировки варьируются: Le train à destination de Lyon, voie B, va partir", "note": "Порядок слов в реальных объявлениях сложнее учебного примера — тренируйся на настоящих записях" }
      ]
    },
    {
      "id": "avoir",
      "title": "Avoir: иметь",
      "level": "A1",
      "rule": "J'ai, tu as, il/elle a, nous avons, vous avez, ils/elles ont. Avoir нужен не только для обладания, но и для возраста (j'ai ... ans) и устойчивых конструкций (avoir besoin de, avoir faim).",
      "examples": ["J'ai vingt-cinq ans.", "Tu as une minute ?", "Nous avons une pause à midi."],
      "paradigm": [
        { "label": "je", "form": "j'ai" },
        { "label": "tu", "form": "tu as" },
        { "label": "il / elle / on", "form": "il a" },
        { "label": "nous", "form": "nous avons" },
        { "label": "vous", "form": "vous avez" },
        { "label": "ils / elles", "form": "ils ont" }
      ],
      "commonMistakes": [
        { "wrong": "возраст выражаешь через être: je suis vingt-cinq ans", "right": "возраст выражается через avoir: j'ai vingt-cinq ans", "note": "В русском «мне 25 лет», по-французски буквально «я имею 25 лет» — глагол другой, чем в русском" },
        { "wrong": "путаешь il a (глагол) и il à на письме", "right": "il a (без ударения) звучит так же, как предлог à — различай по контексту фразы", "note": "Омофоны a/à — частая путаница на письме даже у самих французов" }
      ],
      "exceptions": [
        { "wrong": "avoir спрягается регулярно, как обычный -oir глагол", "right": "avoir — полностью неправильный глагол, формы нужно выучить целиком (особенно ai/as/a/ont)", "note": "Формы совсем не похожи на инфинитив, в отличие от regular глаголов" }
      ]
    },
    {
      "id": "il-y-a",
      "title": "Il y a: есть, имеется",
      "level": "A1",
      "rule": "Il y a не меняется по числам и родам: одна форма для 'есть один стул' и 'есть двадцать стульев'. Отрицание — il n'y a pas de.",
      "examples": ["Il y a dix personnes.", "Il y a vingt chaises.", "Il n'y a pas de café."],
      "paradigm": [
        { "label": "единственное число", "form": "il y a un stylo" },
        { "label": "множественное число", "form": "il y a vingt chaises" },
        { "label": "отрицание", "form": "il n'y a pas de café" },
        { "label": "вопрос", "form": "est-ce qu'il y a du pain ?" }
      ],
      "commonMistakes": [
        { "wrong": "меняешь форму под число: il y ont, il y sont", "right": "il y a не меняется никогда: одна форма и для одного предмета, и для многих", "note": "В отличие от обычных глаголов, il y a — застывшее выражение с фиксированной формой a" },
        { "wrong": "после отрицания оставляешь артикль: il n'y a pas un café", "right": "после отрицания артикль меняется на de: il n'y a pas de café", "note": "Общее правило французского: неопределённый/частичный артикль после отрицания → de" }
      ],
      "exceptions": [
        { "wrong": "il y a используется только для настоящего времени", "right": "il y avait (было), il y aura (будет) — тот же оборот в других временах", "note": "На уровне A1 нужен только настоящий вариант, но полезно узнавать оборот в прошедшем/будущем при чтении" }
      ]
    },
```

- [ ] **Step 2: Проверить**

Run: `node tests/smoke.mjs`
Expected: `Smoke tests passed: 38 lessons, ... .` — без ошибок.

- [ ] **Step 3: Commit**

```bash
git add data/lessons.json
git commit -m "content: add paradigm/commonMistakes/exceptions to grammar topics batch 2"
```

---

### Task 5: Контент — грамматика, батч 3 (daily-routine-present, time-expressions, possessives, adjective-agreement, spelling-contact)

**Files:**
- Modify: `data/lessons.json` (темы `daily-routine-present` … `spelling-contact`)

- [ ] **Step 1: Заменить блок**

Найди:
```json
    {
      "id": "daily-routine-present",
      "title": "Распорядок дня: возвратные глаголы и настоящее время",
      "level": "A1",
      "rule": "Действия распорядка дня часто возвратные: je me lève, je me couche. Местоимение me/te/se стоит перед глаголом. Обычные действия (travailler, manger, dîner) спрягаются как обычные -er глаголы.",
      "examples": ["Je me lève à sept heures.", "Je travaille le matin.", "Je me couche à onze heures."]
    },
    {
      "id": "time-expressions",
      "title": "Дни недели и время: планы",
      "level": "A1",
      "rule": "Дни недели (lundi...dimanche) идут без артикля для одного конкретного дня, но с le для повторяющегося события: le lundi = по понедельникам. Prochain/prochaine — следующий/следующая.",
      "examples": ["Lundi, je travaille.", "Le lundi, je fais du sport.", "On se voit la semaine prochaine ?"]
    },
    {
      "id": "possessives",
      "title": "Притяжательные mon/ma/mes",
      "level": "A1",
      "rule": "Mon/ton/son — перед мужским родом и перед гласной у женского; ma/ta/sa — перед женским согласным; mes/tes/ses — множественное число независимо от рода.",
      "examples": ["mon père", "ma mère", "mes parents"]
    },
    {
      "id": "adjective-agreement",
      "title": "Согласование прилагательных",
      "level": "A1",
      "rule": "Прилагательное согласуется в роде и числе с существительным: обычно +e в женском роде, +s во множественном. Некоторые формы неправильные (beau/belle).",
      "examples": ["un petit garçon", "une petite fille", "des amis sympathiques"]
    },
    {
      "id": "spelling-contact",
      "title": "Буквы и контактные данные",
      "level": "A1",
      "rule": "Чтобы сообщить имя, email или номер, называй группы медленно: prénom, puis adresse email, puis numéro.",
      "examples": ["Ça s'écrit L-E-A.", "Mon numéro est le zéro six…", "Mon adresse email est…"]
    },
```
Замени на:
```json
    {
      "id": "daily-routine-present",
      "title": "Распорядок дня: возвратные глаголы и настоящее время",
      "level": "A1",
      "rule": "Действия распорядка дня часто возвратные: je me lève, je me couche. Местоимение me/te/se стоит перед глаголом. Обычные действия (travailler, manger, dîner) спрягаются как обычные -er глаголы.",
      "examples": ["Je me lève à sept heures.", "Je travaille le matin.", "Je me couche à onze heures."],
      "paradigm": [
        { "label": "je", "form": "je me lève" },
        { "label": "tu", "form": "tu te lèves" },
        { "label": "il / elle / on", "form": "il se lève" },
        { "label": "nous", "form": "nous nous levons" },
        { "label": "vous", "form": "vous vous levez" },
        { "label": "ils / elles", "form": "ils se lèvent" }
      ],
      "commonMistakes": [
        { "wrong": "пропускаешь возвратное местоимение: je lève à sept heures", "right": "je me lève à sept heures — местоимение me обязательно", "note": "Возвратный глагол без своего местоимения меняет смысл или становится грамматически неверным" },
        { "wrong": "ставишь местоимение после глагола: je lève me", "right": "местоимение me/te/se всегда стоит перед спрягаемым глаголом", "note": "Порядок слов во французском для возвратных местоимений фиксированный" }
      ],
      "exceptions": [
        { "wrong": "lever спрягается без изменения гласной во всех формах", "right": "je me lève, но nous nous levons — гласная e меняется на è в ударных формах", "note": "Это стандартное чередование e/è в глаголах на -ever/-eter при ударении на корне" }
      ]
    },
    {
      "id": "time-expressions",
      "title": "Дни недели и время: планы",
      "level": "A1",
      "rule": "Дни недели (lundi...dimanche) идут без артикля для одного конкретного дня, но с le для повторяющегося события: le lundi = по понедельникам. Prochain/prochaine — следующий/следующая.",
      "examples": ["Lundi, je travaille.", "Le lundi, je fais du sport.", "On se voit la semaine prochaine ?"],
      "paradigm": [
        { "label": "конкретный день (без артикля)", "form": "lundi, je travaille" },
        { "label": "повторяющееся событие (с артиклем)", "form": "le lundi, je fais du sport" },
        { "label": "следующий (м.р., после слова)", "form": "lundi prochain" },
        { "label": "следующая (ж.р., после слова)", "form": "la semaine prochaine" }
      ],
      "commonMistakes": [
        { "wrong": "добавляешь le перед днём недели, говоря про этот конкретный день: le lundi je travaille (в этот понедельник)", "right": "для одного конкретного дня артикль не нужен: lundi, je travaille", "note": "Le lundi без уточнения означает «по понедельникам» (регулярность), а не «в этот понедельник»" },
        { "wrong": "ставишь prochain(e) перед словом без согласования: prochain semaine", "right": "prochain/prochaine согласуется в роде и стоит после слова: la semaine prochaine, lundi prochain", "note": "Род зависит от согласуемого существительного (semaine — ж.р., lundi — м.р.)" }
      ],
      "exceptions": [
        { "wrong": "все дни недели ведут себя одинаково при уточнении части дня", "right": "уточнение части дня добавляется без предлога, просто следом за днём: lundi matin (в понедельник утром)", "note": "Конструкция одна для всех дней недели, предлог не нужен" }
      ]
    },
    {
      "id": "possessives",
      "title": "Притяжательные mon/ma/mes",
      "level": "A1",
      "rule": "Mon/ton/son — перед мужским родом и перед гласной у женского; ma/ta/sa — перед женским согласным; mes/tes/ses — множественное число независимо от рода.",
      "examples": ["mon père", "ma mère", "mes parents"],
      "paradigm": [
        { "label": "м.р. ед.ч.", "form": "mon père" },
        { "label": "ж.р. ед.ч.", "form": "ma mère" },
        { "label": "мн.ч. (любой род)", "form": "mes parents" },
        { "label": "ж.р. перед гласной", "form": "mon amie (не ma amie)" }
      ],
      "commonMistakes": [
        { "wrong": "выбираешь mon/ma по полу владельца, как в английском his/her", "right": "mon/ma/mes согласуются с родом и числом предмета обладания, а не с полом говорящего", "note": "Русскоговорящим и англоговорящим особенно легко перепутать логику — во французском важен род существительного после" },
        { "wrong": "перед гласной оставляешь ma: ma amie", "right": "перед гласной или немым h форма мужского рода mon используется даже для женского слова: mon amie", "note": "Это фонетическое исключение — избегает зияния двух гласных подряд, как l' у артиклей" }
      ],
      "exceptions": [
        { "wrong": "во множественном числе род тоже влияет на форму: mes/tes/ses различаются по роду", "right": "mes/tes/ses — одна форма для мужского и женского рода во множественном числе", "note": "Различие по родам (mon/ma, ton/ta, son/sa) исчезает во множественном числе" }
      ]
    },
    {
      "id": "adjective-agreement",
      "title": "Согласование прилагательных",
      "level": "A1",
      "rule": "Прилагательное согласуется в роде и числе с существительным: обычно +e в женском роде, +s во множественном. Некоторые формы неправильные (beau/belle).",
      "examples": ["un petit garçon", "une petite fille", "des amis sympathiques"],
      "paradigm": [
        { "label": "м.р. ед.ч. (базовая форма)", "form": "un petit garçon" },
        { "label": "ж.р. ед.ч. (+e)", "form": "une petite fille" },
        { "label": "м.р. мн.ч. (+s)", "form": "des garçons sympathiques" },
        { "label": "ж.р. мн.ч. (+es)", "form": "des filles sympathiques" }
      ],
      "commonMistakes": [
        { "wrong": "оставляешь прилагательное в мужском роде для существительного женского рода: une fille petit", "right": "прилагательное должно совпасть в роде: une fille petite", "note": "Согласование обязательно для всех прилагательных, кроме неизменяемых (например marron)" },
        { "wrong": "добавляешь лишнее e к прилагательным, уже оканчивающимся на -e", "right": "прилагательные на -e в мужском роде не меняются в женском: un livre rouge / une robe rouge", "note": "Финальное -e уже есть, второй раз его не добавляют" }
      ],
      "exceptions": [
        { "wrong": "все прилагательные образуют женский род через +e", "right": "beau/belle, vieux/vieille, nouveau/nouvelle — отдельные неправильные формы", "note": "Небольшая группа частотных прилагательных меняет форму целиком, а не просто добавляет -e" }
      ]
    },
    {
      "id": "spelling-contact",
      "title": "Буквы и контактные данные",
      "level": "A1",
      "rule": "Чтобы сообщить имя, email или номер, называй группы медленно: prénom, puis adresse email, puis numéro.",
      "examples": ["Ça s'écrit L-E-A.", "Mon numéro est le zéro six…", "Mon adresse email est…"],
      "paradigm": [
        { "label": "произнести имя по буквам", "form": "Ça s'écrit L-E-A" },
        { "label": "email", "form": "Mon adresse email est marie point dupont arobase mail point fr" },
        { "label": "номер телефона (по парам цифр)", "form": "zéro six, douze, trente-quatre..." }
      ],
      "commonMistakes": [
        { "wrong": "диктуешь номер телефона по одной цифре подряд без пауз", "right": "французы группируют номер по парам: zéro six, douze, trente-quatre, cinquante-six", "note": "Так проще и воспринимать, и произносить — привычная система для носителя" },
        { "wrong": "произносишь @ как английское at", "right": "@ по-французски arobase", "note": "Заимствованное английское at не используется в стандартной французской речи" }
      ],
      "exceptions": [
        { "wrong": "буквы алфавита читаются побуквенно как в русском письме", "right": "французский алфавит читается по-своему: A = a, E = euh, I = i, W = double-vé", "note": "Особенно отличаются: W (double-vé), Y (i grec), и буквы с диакритикой (é = e accent aigu)" }
      ]
    },
```

- [ ] **Step 2: Проверить**

Run: `node tests/smoke.mjs`
Expected: `Smoke tests passed: 38 lessons, ... .` — без ошибок.

- [ ] **Step 3: Commit**

```bash
git add data/lessons.json
git commit -m "content: add paradigm/commonMistakes/exceptions to grammar topics batch 3"
```

---

### Task 6: Контент — грамматика, батч 4 (dates-deadlines, place-prepositions, high-frequency-present, health-needs, likes-reasons)

**Files:**
- Modify: `data/lessons.json` (темы `dates-deadlines` … `likes-reasons`, последние в массиве `grammarTopics`)

- [ ] **Step 1: Заменить блок**

Найди (обрати внимание: последний объект в файле без запятой после `}`):
```json
    {
      "id": "dates-deadlines",
      "title": "Даты, месяцы и дедлайны",
      "level": "A1",
      "rule": "Для даты обычно говорят le + число + месяц; pour — срок к определённой дате.",
      "examples": ["Nous sommes le 12 octobre.", "Le cours commence en septembre.", "C'est pour lundi."]
    },
    {
      "id": "place-prepositions",
      "title": "Где это: à, dans, près de",
      "level": "A1",
      "rule": "À — место как точка, dans — внутри, près de — рядом. Сначала назови место, затем уточни ориентир.",
      "examples": ["La salle est au premier étage.", "La bibliothèque est dans le bâtiment B.", "Le secrétariat est près de la cafétéria."]
    },
    {
      "id": "high-frequency-present",
      "title": "Частотные глаголы в настоящем",
      "level": "A1",
      "rule": "Учи частые формы целыми кусками: je vais, je fais, je prends, je viens, je peux, je veux.",
      "examples": ["Je vais en cours.", "Je prends le bus.", "Je peux imprimer ici ?"]
    },
    {
      "id": "health-needs",
      "title": "Самочувствие и необходимость",
      "level": "A1",
      "rule": "Avoir mal à + часть тела описывает боль; je dois / je peux вежливо объясняют, что нужно сделать.",
      "examples": ["J'ai mal à la tête.", "Je dois voir un médecin.", "Je peux aller à la pharmacie ?"]
    },
    {
      "id": "likes-reasons",
      "title": "Предпочтения и причина",
      "level": "A1",
      "rule": "J'aime / je préfère + существительное или инфинитив; parce que коротко объясняет причину.",
      "examples": ["J'aime faire du sport.", "Je préfère le cinéma.", "Je reste ici parce que je travaille."]
    }
  ],
```
Замени на:
```json
    {
      "id": "dates-deadlines",
      "title": "Даты, месяцы и дедлайны",
      "level": "A1",
      "rule": "Для даты обычно говорят le + число + месяц; pour — срок к определённой дате.",
      "examples": ["Nous sommes le 12 octobre.", "Le cours commence en septembre.", "C'est pour lundi."],
      "paradigm": [
        { "label": "формула даты", "form": "le 12 octobre" },
        { "label": "первое число месяца (искл.)", "form": "le premier septembre" },
        { "label": "месяц как период", "form": "en septembre" },
        { "label": "срок к дате", "form": "pour lundi" }
      ],
      "commonMistakes": [
        { "wrong": "используешь порядковые числительные для всех дат: le douzième octobre", "right": "для дат используются количественные числительные: le douze octobre", "note": "Порядковые (premier, deuxième...) используются только для первого числа месяца — le premier" },
        { "wrong": "перед месяцем ставишь de: le cours commence de septembre", "right": "период времени внутри месяца выражается через en: en septembre", "note": "En — стандартный предлог для месяцев и годов: en 2026" }
      ],
      "exceptions": [
        { "wrong": "первое число месяца тоже называется le un: le un octobre", "right": "первое число — исключение: le premier octobre, а не le un", "note": "Это единственный день месяца, для которого используется порядковое числительное вместо количественного" }
      ]
    },
    {
      "id": "place-prepositions",
      "title": "Где это: à, dans, près de",
      "level": "A1",
      "rule": "À — место как точка, dans — внутри, près de — рядом. Сначала назови место, затем уточни ориентир.",
      "examples": ["La salle est au premier étage.", "La bibliothèque est dans le bâtiment B.", "Le secrétariat est près de la cafétéria."],
      "paradigm": [
        { "label": "точка / направление", "form": "à la bibliothèque" },
        { "label": "внутри", "form": "dans le bâtiment B" },
        { "label": "рядом", "form": "près de la cafétéria" },
        { "label": "напротив", "form": "en face de l'entrée" }
      ],
      "commonMistakes": [
        { "wrong": "используешь à вместо dans, когда речь про «внутри чего-то»", "right": "если предмет/место находится внутри объёма — нужен dans: dans le bâtiment", "note": "À указывает скорее на точку на карте, dans — на нахождение внутри пространства" },
        { "wrong": "после près забываешь de: près la cafétéria", "right": "près всегда идёт с de перед следующим существительным: près de la cafétéria", "note": "Près — часть устойчивого сочетания près de, само по себе перед существительным не употребляется" }
      ],
      "exceptions": [
        { "wrong": "à + le всегда остаётся как есть: à le premier étage", "right": "à + le сливается в au: au premier étage", "note": "Слияние предлога с определённым артиклем — обязательное грамматическое правило (à+le=au, à+les=aux)" }
      ]
    },
    {
      "id": "high-frequency-present",
      "title": "Частотные глаголы в настоящем",
      "level": "A1",
      "rule": "Учи частые формы целыми кусками: je vais, je fais, je prends, je viens, je peux, je veux.",
      "examples": ["Je vais en cours.", "Je prends le bus.", "Je peux imprimer ici ?"],
      "paradigm": [
        { "label": "aller (идти/ехать)", "form": "je vais" },
        { "label": "faire (делать)", "form": "je fais" },
        { "label": "prendre (брать/ехать на)", "form": "je prends" },
        { "label": "venir (приходить)", "form": "je viens" },
        { "label": "pouvoir (мочь)", "form": "je peux" },
        { "label": "vouloir (хотеть)", "form": "je veux" }
      ],
      "commonMistakes": [
        { "wrong": "спрягаешь эти глаголы по регулярной модели -er/-re", "right": "все шесть — неправильные глаголы, формы нужно заучивать целиком, не выводить по правилу", "note": "Это одни из самых частотных глаголов языка — их нерегулярность встречается постоянно, поэтому учить нужно наизусть с первого урока" },
        { "wrong": "путаешь je peux (могу) и je veux (хочу) на слух и по написанию", "right": "peux — от pouvoir (возможность), veux — от vouloir (желание), разные глаголы", "note": "Похожи по звучанию, но означают разное — важно не перепутать в просьбе" }
      ],
      "exceptions": [
        { "wrong": "prendre всегда означает «брать в руки»", "right": "prendre le bus / prendre un café — «ехать на» и «выпить/съесть», а не только «взять рукой»", "note": "Prendre — многозначный глагол, значение зависит от дополнения" }
      ]
    },
    {
      "id": "health-needs",
      "title": "Самочувствие и необходимость",
      "level": "A1",
      "rule": "Avoir mal à + часть тела описывает боль; je dois / je peux вежливо объясняют, что нужно сделать.",
      "examples": ["J'ai mal à la tête.", "Je dois voir un médecin.", "Je peux aller à la pharmacie ?"],
      "paradigm": [
        { "label": "боль + часть тела (ж.р.)", "form": "j'ai mal à la tête" },
        { "label": "боль + часть тела (м.р.)", "form": "j'ai mal au ventre" },
        { "label": "обязанность", "form": "je dois voir un médecin" },
        { "label": "разрешение/возможность (вопрос)", "form": "je peux aller à la pharmacie ?" }
      ],
      "commonMistakes": [
        { "wrong": "после mal à используешь артикль без слияния: mal à le ventre", "right": "à + le сливается в au: j'ai mal au ventre", "note": "То же правило слияния предлога с артиклем, что и в теме place-prepositions (à+le=au)" },
        { "wrong": "je dois понимаешь как отдельное существительное «долг»", "right": "je dois здесь — глагол devoir (должен что-то сделать), за ним идёт инфинитив: je dois partir", "note": "Devoir как глагол долженствования требует инфинитив следующего действия" }
      ],
      "exceptions": [
        { "wrong": "часть тела всегда женского рода, поэтому всегда à la", "right": "род части тела разный: la tête (ж.р.) → à la, но le ventre (м.р.) → au", "note": "Нужно помнить род каждой части тела отдельно, чтобы выбрать правильное слияние предлога" }
      ]
    },
    {
      "id": "likes-reasons",
      "title": "Предпочтения и причина",
      "level": "A1",
      "rule": "J'aime / je préfère + существительное или инфинитив; parce que коротко объясняет причину.",
      "examples": ["J'aime faire du sport.", "Je préfère le cinéma.", "Je reste ici parce que je travaille."],
      "paradigm": [
        { "label": "нравится + существительное", "form": "j'aime le cinéma" },
        { "label": "нравится + инфинитив", "form": "j'aime faire du sport" },
        { "label": "предпочтение", "form": "je préfère le cinéma" },
        { "label": "причина", "form": "parce que je travaille" }
      ],
      "commonMistakes": [
        { "wrong": "после j'aime используешь de перед инфинитивом: j'aime de faire du sport", "right": "j'aime + инфинитив без предлога: j'aime faire du sport", "note": "В отличие от некоторых других конструкций, aimer не требует de перед следующим глаголом" },
        { "wrong": "путаешь parce que и pourquoi по смыслу", "right": "pourquoi — вопрос «почему», parce que — ответ «потому что»", "note": "Оба слова похожи по звучанию (que/quoi), но одно вопросительное, другое — для ответа" }
      ],
      "exceptions": [
        { "wrong": "aimer всегда переводится как романтическая любовь", "right": "j'aime le cinéma — просто «нравится», без романтического оттенка", "note": "Для чувств к людям есть отдельные конструкции (aimer bien для дружеской симпатии), но на A1 aimer к предметам/занятиям — нейтральное «нравится»" }
      ]
    }
  ],
```

- [ ] **Step 2: Проверить**

Run: `node tests/smoke.mjs`
Expected: `Smoke tests passed: 38 lessons, ... .` — без ошибок.

- [ ] **Step 3: Commit**

```bash
git add data/lessons.json
git commit -m "content: add paradigm/commonMistakes/exceptions to grammar topics batch 4"
```

---

### Task 7: Сделать поля обязательными (финальное переключение схемы)

**Files:**
- Modify: `course-schema.js:1`, `course-schema.js:67-74`
- Modify: `data/lessons.json:4` (`meta.catalogSchemaVersion`)

**Interfaces:**
- Consumes: весь контент из задач 2-6 (все 26 тем уже содержат непустые `paradigm`/`commonMistakes`/`exceptions`).
- Produces: `COURSE_SCHEMA_VERSION === 3`; `pronunciationTopic`/`grammarTopic` требуют эти поля через `requiredArrays`.

- [ ] **Step 1: Написать падающий тест**

В `tests/smoke.mjs` найди (уже существующую строку):
```js
assert.equal(validateCourseCatalog(data), true);
```
Оставь её как есть — она уже проверяет полный каталог. Дополнительно перед ней временно НЕ добавляем новый ассерт: сам факт, что `COURSE_SCHEMA_VERSION` (2) не совпадёт с `data.meta.catalogSchemaVersion` после Step 3, заставит эту существующую строку упасть первой — это и есть естественный «красный» шаг. Пропусти отдельный новый ассерт, перейди к Step 2.

- [ ] **Step 2: Убедиться в текущем «зелёном» состоянии до правки**

Run: `node tests/smoke.mjs`
Expected: `Smoke tests passed: 38 lessons, ... .` (весь контент уже на месте, но поля пока не обязательны — тест зелёный).

- [ ] **Step 3: Бампнуть версию схемы**

В `course-schema.js:1`:
```js
export const COURSE_SCHEMA_VERSION = 2;
```
→
```js
export const COURSE_SCHEMA_VERSION = 3;
```

В `data/lessons.json:4` (внутри `"meta"`):
```json
    "catalogSchemaVersion": 2,
```
→
```json
    "catalogSchemaVersion": 3,
```

- [ ] **Step 4: Сделать поля обязательными**

В `course-schema.js:67-74`:
```js
  pronunciationTopic: Object.freeze({
    requiredText: Object.freeze(["id", "title", "level", "target", "cue"]),
    requiredArrays: Object.freeze(["minimalPairs"])
  }),
  grammarTopic: Object.freeze({
    requiredText: Object.freeze(["id", "title", "level", "rule"]),
    requiredArrays: Object.freeze(["examples"])
  }),
```
→
```js
  pronunciationTopic: Object.freeze({
    requiredText: Object.freeze(["id", "title", "level", "target", "cue"]),
    requiredArrays: Object.freeze(["minimalPairs", "paradigm", "commonMistakes", "exceptions"])
  }),
  grammarTopic: Object.freeze({
    requiredText: Object.freeze(["id", "title", "level", "rule"]),
    requiredArrays: Object.freeze(["examples", "paradigm", "commonMistakes", "exceptions"])
  }),
```

- [ ] **Step 5: Проверить, что весь набор тестов зелёный**

Run:
```bash
node tests/smoke.mjs
node tests/exercises.mjs
node tests/mastery.mjs
node tests/technical.mjs
node tests/card-manifest.mjs
node tests/tts-cache.mjs
```
Expected: все шесть команд завершаются без ошибок (последняя строка `smoke.mjs` — `Smoke tests passed: 38 lessons, ... .`).

- [ ] **Step 6: Commit**

```bash
git add course-schema.js data/lessons.json
git commit -m "feat: require paradigm/commonMistakes/exceptions on every reference topic (schema v3)"
```

---

### Task 8: Рендер справочных страниц — новые блоки и якоря

**Files:**
- Modify: `app.js:266-299` (`renderPronunciation`, `renderGrammar`)

**Interfaces:**
- Produces: `renderParadigm(paradigm)`, `renderMistakeBlock(heading, items)` — используются задачей 8 и переиспользуются нигде больше (лесонный вид намеренно остаётся компактным, задача 10).
- Consumes: `topic.paradigm`, `topic.commonMistakes`, `topic.exceptions` (гарантированно присутствуют и непусты начиная с задачи 7).

- [ ] **Step 1: Добавить хелперы рендера и якоря, обновить `renderPronunciation`/`renderGrammar`**

В `app.js` найди блок (строки 266-299):
```js
function renderPronunciation() {
  app.innerHTML = `
    <section class="section-band">
      <div class="section-heading"><div><p class="eyebrow">Каждый день</p><h4>Звуки и правила чтения</h4></div></div>
      <div class="phrase-grid">
        ${state.data.pronunciationTopics.map((topic) => `
          <article class="phrase-tile">
            <span class="tag rose">${escapeHtml(topic.level)}</span>
            <h5 class="compact-title">${escapeHtml(topic.title)}</h5>
            <p class="fr">${escapeHtml(topic.target)}</p>
            <p class="note">${escapeHtml(topic.cue)}</p>
            <p class="note"><strong>Мини-пары:</strong> ${topic.minimalPairs.map(escapeHtml).join(", ")}</p>
            ${renderVoiceLab(topic.target, `pronunciation:${topic.id}`)}
          </article>`).join("")}
      </div>
    </section>`;
  bindVoiceLabs();
}

function renderGrammar() {
  app.innerHTML = `
    <section class="section-band">
      <div class="section-heading"><div><p class="eyebrow">Фокус на форме</p><h4>Грамматика как справочник</h4></div></div>
      <div class="phrase-grid">
        ${state.data.grammarTopics.map((topic) => `
          <article class="phrase-tile">
            <span class="tag amber">${escapeHtml(topic.level)}</span>
            <h5 class="compact-title">${escapeHtml(topic.title)}</h5>
            <p class="grammar-rule">${escapeHtml(topic.rule)}</p>
            <ul class="example-list">${topic.examples.map((example) => `<li>${escapeHtml(example)}</li>`).join("")}</ul>
          </article>`).join("")}
      </div>
    </section>`;
}
```
Замени на:
```js
function renderParadigm(paradigm) {
  return `<div class="paradigm-table">${paradigm.map((entry) => `<div class="paradigm-row"><span class="paradigm-label">${escapeHtml(entry.label)}</span><span class="paradigm-form">${escapeHtml(entry.form)}</span></div>`).join("")}</div>`;
}

function renderMistakeBlock(heading, items) {
  return `<div class="mistake-list"><p class="mistake-list-heading">${escapeHtml(heading)}</p>${items.map((entry) => `<div class="mistake-row"><span class="mistake-wrong">${escapeHtml(entry.wrong)}</span><span class="mistake-arrow">→</span><span class="mistake-right">${escapeHtml(entry.right)}</span><span class="mistake-note">${escapeHtml(entry.note)}</span></div>`).join("")}</div>`;
}

function renderPronunciation() {
  app.innerHTML = `
    <section class="section-band">
      <div class="section-heading"><div><p class="eyebrow">Каждый день</p><h4>Звуки и правила чтения</h4></div></div>
      <div class="phrase-grid">
        ${state.data.pronunciationTopics.map((topic) => `
          <article class="phrase-tile" id="topic-pronunciation-${escapeHtml(topic.id)}">
            <span class="tag rose">${escapeHtml(topic.level)}</span>
            <h5 class="compact-title">${escapeHtml(topic.title)}</h5>
            <p class="fr">${escapeHtml(topic.target)}</p>
            <p class="note">${escapeHtml(topic.cue)}</p>
            <p class="note"><strong>Мини-пары:</strong> ${topic.minimalPairs.map(escapeHtml).join(", ")}</p>
            ${renderParadigm(topic.paradigm)}
            ${renderMistakeBlock("Типичные ошибки", topic.commonMistakes)}
            ${renderMistakeBlock("Исключения", topic.exceptions)}
            ${renderVoiceLab(topic.target, `pronunciation:${topic.id}`)}
          </article>`).join("")}
      </div>
    </section>`;
  bindVoiceLabs();
}

function renderGrammar() {
  app.innerHTML = `
    <section class="section-band">
      <div class="section-heading"><div><p class="eyebrow">Фокус на форме</p><h4>Грамматика как справочник</h4></div></div>
      <div class="phrase-grid">
        ${state.data.grammarTopics.map((topic) => `
          <article class="phrase-tile" id="topic-grammar-${escapeHtml(topic.id)}">
            <span class="tag amber">${escapeHtml(topic.level)}</span>
            <h5 class="compact-title">${escapeHtml(topic.title)}</h5>
            <p class="grammar-rule">${escapeHtml(topic.rule)}</p>
            <ul class="example-list">${topic.examples.map((example) => `<li>${escapeHtml(example)}</li>`).join("")}</ul>
            ${renderParadigm(topic.paradigm)}
            ${renderMistakeBlock("Типичные ошибки", topic.commonMistakes)}
            ${renderMistakeBlock("Исключения", topic.exceptions)}
          </article>`).join("")}
      </div>
    </section>`;
}
```

- [ ] **Step 2: Проверить в браузере (в проекте нет DOM-тестов — это ручная проверка)**

Run: `python3 server.py` (или используй уже запущенный сервер).
Открой `http://localhost:5173`, перейди на вкладку «Произношение».
Expected: под мини-парами каждой темы видна таблица форм (paradigm), затем «Типичные ошибки» и «Исключения» с зачёркнутым неверным вариантом, стрелкой и верным вариантом. Открой «Грамматика» — та же структура блоков под списком примеров.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: render paradigm/mistakes/exceptions on reference pages"
```

---

### Task 9: Стили новых блоков

**Files:**
- Modify: `styles.css` (добавить новые классы после блока `.example-list, .exercise-list ol, .checklist {...}`, строки 560-566)

- [ ] **Step 1: Добавить CSS**

В `styles.css` найди:
```css
.example-list,
.exercise-list ol,
.checklist {
  margin: 0;
  padding-left: 1.3rem;
  line-height: 1.7;
}
```
Сразу после этого блока добавь:
```css

.paradigm-table {
  display: grid;
  gap: 6px;
  margin: 10px 0;
}

.paradigm-row {
  display: flex;
  gap: 10px;
  align-items: baseline;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--surface-strong);
}

.paradigm-label {
  min-width: 90px;
  color: var(--muted);
  font-weight: 800;
  font-size: 0.82rem;
}

.paradigm-form {
  font-weight: 800;
}

.mistake-list {
  margin: 10px 0;
}

.mistake-list-heading {
  margin: 0 0 6px;
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 900;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.mistake-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  padding: 6px 0;
  line-height: 1.4;
}

.mistake-wrong {
  color: var(--rose);
  text-decoration: line-through;
}

.mistake-arrow {
  color: var(--muted);
}

.mistake-right {
  color: var(--accent-dark);
  font-weight: 800;
}

.mistake-note {
  flex-basis: 100%;
  color: var(--muted);
  font-size: 0.86rem;
}

.topic-highlight {
  animation: topic-flash 1.6s ease-out;
}

@keyframes topic-flash {
  0% { box-shadow: 0 0 0 3px var(--accent); }
  100% { box-shadow: 0 0 0 0 transparent; }
}
```

- [ ] **Step 2: Проверить в браузере**

Открой `http://localhost:5173` (сервер должен быть запущен — см. задачу 8), вкладка «Произношение»/«Грамматика».
Expected: таблица paradigm выглядит как компактные строки label/form на сером фоне; ошибки/исключения — зачёркнутый неверный вариант розовым, стрелка, верный вариант зелёным, примечание отдельной строкой снизу.

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "style: add paradigm/mistake block styles"
```

---

### Task 10: Ссылка «Подробнее →» из урока и переход к карточке темы

**Files:**
- Modify: `app.js:42-66` (`state`), `app.js:160-182` (`render`), `app.js:493-498` (`bindLessonActions`), `app.js:1179-1187` (`renderPronunciationForLesson`, `renderGrammarForLesson`)

**Interfaces:**
- Consumes: `state.data.pronunciationTopics`/`state.data.grammarTopics`, `switchView(view)` (существующая функция), DOM-якоря `topic-pronunciation-<id>`/`topic-grammar-<id>` (задача 8).
- Produces: `state.pendingTopicFocus` (строка вида `topic-pronunciation-r` или `null`), `openTopicReference(key)`.

- [ ] **Step 1: Добавить поле состояния**

В `app.js:42-66` найди:
```js
  saveTimers: new Map(),
  pendingSaves: new Map(),
  activeSaveCount: 0
};
```
Замени на:
```js
  saveTimers: new Map(),
  pendingSaves: new Map(),
  activeSaveCount: 0,
  pendingTopicFocus: null
};
```

- [ ] **Step 2: Обновить `render()`, чтобы скроллить к теме, если задан `pendingTopicFocus`**

В `app.js:160-182` найди:
```js
function render() {
  releaseAudioUrls();
  title.textContent = viewTitles[state.view];
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });

  const renderers = {
    today: renderToday,
    lessons: renderLessons,
    pronunciation: renderPronunciation,
    grammar: renderGrammar,
    vocabulary: renderVocabulary,
    review: renderReview,
    progress: renderProgress,
    settings: renderSettings
  };
  renderers[state.view]();

  requestAnimationFrame(() => {
    window.scrollTo({ top: state.appState.scrollPositions[state.view] || 0, behavior: "instant" });
  });
}
```
Замени на:
```js
function render() {
  releaseAudioUrls();
  title.textContent = viewTitles[state.view];
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });

  const renderers = {
    today: renderToday,
    lessons: renderLessons,
    pronunciation: renderPronunciation,
    grammar: renderGrammar,
    vocabulary: renderVocabulary,
    review: renderReview,
    progress: renderProgress,
    settings: renderSettings
  };
  renderers[state.view]();

  const focusId = state.pendingTopicFocus;
  state.pendingTopicFocus = null;
  requestAnimationFrame(() => {
    const target = focusId && document.getElementById(focusId);
    if (target) {
      target.scrollIntoView({ behavior: "instant", block: "start" });
      target.classList.add("topic-highlight");
      target.addEventListener("animationend", () => target.classList.remove("topic-highlight"), { once: true });
    } else {
      window.scrollTo({ top: state.appState.scrollPositions[state.view] || 0, behavior: "instant" });
    }
  });
}
```

- [ ] **Step 3: Добавить обработчик клика и `openTopicReference`**

В `app.js:493-498` найди:
```js
function bindLessonActions(container, lesson) {
  container.querySelectorAll("[data-speak]").forEach((button) => {
    button.addEventListener("click", () => speakFrench(button.dataset.speak));
  });
  container.querySelectorAll(".exercise").forEach((box) => bindExercise(box, lesson));
}
```
Замени на:
```js
function bindLessonActions(container, lesson) {
  container.querySelectorAll("[data-speak]").forEach((button) => {
    button.addEventListener("click", () => speakFrench(button.dataset.speak));
  });
  container.querySelectorAll("[data-open-topic]").forEach((button) => {
    button.addEventListener("click", () => openTopicReference(button.dataset.openTopic));
  });
  container.querySelectorAll(".exercise").forEach((box) => bindExercise(box, lesson));
}

function openTopicReference(key) {
  const [kind, id] = key.split(":");
  state.pendingTopicFocus = `topic-${kind}-${id}`;
  switchView(kind);
}
```

- [ ] **Step 4: Добавить ссылку «Подробнее →» в компактный вид урока**

В `app.js:1179-1187` найди:
```js
function renderPronunciationForLesson(lesson) {
  const topic = state.data.pronunciationTopics.find((item) => item.id === lesson.pronunciationTopic);
  return `<div class="target-phrase"><span class="tag rose">${escapeHtml(topic.level)}</span><strong>${escapeHtml(topic.title)}</strong><span>${escapeHtml(topic.target)}</span></div><p class="note">${escapeHtml(topic.cue)}</p><ul class="example-list">${topic.minimalPairs.map((pair) => `<li>${escapeHtml(pair)}</li>`).join("")}</ul>`;
}

function renderGrammarForLesson(lesson) {
  const topic = state.data.grammarTopics.find((item) => item.id === lesson.grammarTopic);
  return `<div class="target-phrase"><span class="tag amber">${escapeHtml(topic.level)}</span><strong>${escapeHtml(topic.title)}</strong></div><p class="grammar-rule">${escapeHtml(topic.rule)}</p><ul class="example-list">${topic.examples.map((example) => `<li>${escapeHtml(example)}</li>`).join("")}</ul>`;
}
```
Замени на:
```js
function renderPronunciationForLesson(lesson) {
  const topic = state.data.pronunciationTopics.find((item) => item.id === lesson.pronunciationTopic);
  return `<div class="target-phrase"><span class="tag rose">${escapeHtml(topic.level)}</span><strong>${escapeHtml(topic.title)}</strong><span>${escapeHtml(topic.target)}</span></div><p class="note">${escapeHtml(topic.cue)}</p><ul class="example-list">${topic.minimalPairs.map((pair) => `<li>${escapeHtml(pair)}</li>`).join("")}</ul><button class="pill-button" type="button" data-open-topic="pronunciation:${escapeHtml(topic.id)}">Подробнее →</button>`;
}

function renderGrammarForLesson(lesson) {
  const topic = state.data.grammarTopics.find((item) => item.id === lesson.grammarTopic);
  return `<div class="target-phrase"><span class="tag amber">${escapeHtml(topic.level)}</span><strong>${escapeHtml(topic.title)}</strong></div><p class="grammar-rule">${escapeHtml(topic.rule)}</p><ul class="example-list">${topic.examples.map((example) => `<li>${escapeHtml(example)}</li>`).join("")}</ul><button class="pill-button" type="button" data-open-topic="grammar:${escapeHtml(topic.id)}">Подробнее →</button>`;
}
```

- [ ] **Step 5: Проверить в браузере**

Открой `http://localhost:5173`, вкладка «Уроки», открой любой урок.
Expected: под блоком произношения и под блоком грамматики появилась кнопка «Подробнее →». Клик по кнопке в блоке произношения переключает на вкладку «Произношение» и скроллит точно к карточке нужной темы, карточка на секунду подсвечивается рамкой. То же для кнопки в блоке грамматики → вкладка «Грамматика».

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "feat: link from lesson to full reference topic card"
```

---

### Task 11: Финальная проверка

**Files:** нет изменений — только верификация.

- [ ] **Step 1: Полный прогон автотестов**

Run:
```bash
node tests/smoke.mjs
node tests/exercises.mjs
node tests/mastery.mjs
node tests/technical.mjs
node tests/card-manifest.mjs
node tests/tts-cache.mjs
python3 tests/test_server.py
```
Expected: все команды завершаются без ошибок/трейсбеков.

- [ ] **Step 2: Ручная проверка в браузере — полный путь**

С запущенным `python3 server.py`:
1. Вкладка «Произношение» — каждая из 5 карточек показывает мини-пары, таблицу форм, «Типичные ошибки», «Исключения».
2. Вкладка «Грамматика» — каждая из 21 карточки показывает то же самое под списком примеров.
3. Открой урок, где используется тема `"r"` (например, урок про приветствие) — блок произношения компактный (cue + мини-пары + кнопка «Подробнее →»), без таблиц/ошибок.
4. Клик «Подробнее →» в блоке произношения → переход на вкладку «Произношение», скролл и подсветка карточки `r`.
5. Вернись в урок, клик «Подробнее →» в блоке грамматики → переход на вкладку «Грамматика», скролл и подсветка нужной карточки.

Expected: все 5 шагов проходят без ошибок в консоли браузера (проверь `preview_console_logs`/DevTools).

- [ ] **Step 3: Итоговый коммит (если остались незакоммиченные правки)**

```bash
git status
```
Expected: `nothing to commit, working tree clean` (все предыдущие задачи уже закоммичены по отдельности).
