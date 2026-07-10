# Дизайн: углубление справочника произношения и грамматики

Дата: 2026-07-10

## Проблема

`pronunciationTopics[]` и `grammarTopics[]` в [data/lessons.json](../../../data/lessons.json#L520) — общий справочник, на который ссылаются уроки по id (`lesson.pronunciationTopic`, `lesson.grammarTopic`). Каждая тема сейчас несёт минимум содержания:

- тема произношения: одна строка-подсказка (`cue`) + 2-3 минимальные пары ([data/lessons.json:520-560](../../../data/lessons.json#L520));
- тема грамматики: одно предложение-правило (`rule`) + 2-3 примера ([data/lessons.json:562-709](../../../data/lessons.json#L562)).

Так как темы переиспользуются несколькими уроками (например, тему `"r"` использует не один урок), ученик видит один и тот же `cue`/`rule` каждый раз без развития. Субъективно оба раздела («Звуки и правила чтения», «Грамматика как справочник» — [app.js:266-299](../../../app.js#L266)) ощущаются недостаточно раскрытыми.

## Выбранный подход

Обогатить сами карточки справочника тремя новыми обязательными блоками (не делать темы per-lesson — это сломало бы идею переиспользуемого справочника и потребовало бы переписать структуру уроков без выигрыша в глубине):

1. **`paradigm: [{label, form}]`** — таблица вариантов формы.
   - Для грамматики: `label` — местоимение (je/tu/il...), либо род/число (m.sg/f.sg/pl) для не-глагольных тем (артикли, прилагательные), либо регистр речи (разговорный/нейтральный/формальный) для тем про вопросы/формулы. `form` — сама форма.
   - Для произношения: `label` — позиция/контекст звука в слове (начало/середина/конец, ударный/безударный, перед гласной/согласной — по теме), `form` — пример слова с этим звуком.
2. **`commonMistakes: [{wrong, right, note}]`** — типичная ошибка носителя русского → верный вариант → короткая причина.
3. **`exceptions: [{wrong, right, note}]`** — тот же формат для исключений из общего правила (например `beau` → `belle`, а не `*beaue`).

Оба новых массива (`commonMistakes`, `exceptions`) используют одну и ту же форму `{wrong, right, note}` — единообразно для UI и для валидатора.

**Обязательность:** все три поля обязательны и непустые для КАЖДОЙ из 5 тем произношения и 21 темы грамматики — это и есть решение исходной проблемы «то и дело тонких карточек», а не опция, которую можно пропустить.

**Отклонённые варианты** (обсуждены и отвергнуты в диалоге до спеки):
- Per-lesson `cue`/`rule` вместо общего справочника — ломает переиспользование тем между уроками, требует переписать много уроков.
- Просто расширить `examples`/`minimalPairs` без новой структуры — дешевле, но не даёт предсказуемой вёрстки и не решает выбранные пользователем направления (ошибки, исключения, полнота парадигмы).
- Показывать новые блоки прямо в уроке — перегружает поток урока (метод «сначала фраза, грамматика после» — см. `meta.method`); решение: полный набор только на справочных страницах.

## Схема данных

### `course-schema.js`

```js
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
})
```

`COURSE_SCHEMA_VERSION` бампается с 2 на 3 (структурное изменение схемы); `meta.catalogSchemaVersion` в `data/lessons.json` обновляется соответственно — иначе `course-validator.js` уже отклоняет файл на первой проверке ([course-validator.js:17-19](../../../course-validator.js#L17)).

### `course-validator.js`

В блоках валидации `pronunciationTopics`/`grammarTopics` ([course-validator.js:88-103](../../../course-validator.js#L88)) добавить проход по `paradigm`, `commonMistakes`, `exceptions` с `validateObject(entry, path, COURSE_SCHEMA.paradigmEntry / mistakeEntry, errors)`, аналогично тому, как уже валидируются `dialogue`/`vocabulary` внутри уроков.

## Контент: что нужно написать

Обогатить все существующие темы реальным лингвистическим содержанием (на русском, в текущем тоне — коротко и практично, без академизма):

**Произношение (5 тем)**: `u-y`, `nasals`, `r`, `liaison`, `silent-endings`.
**Грамматика (21 тема)**: `fixed-phrases`, `etre`, `articles`, `questions`, `voudrais`, `near-future`, `needs-negation`, `prices-hours`, `announcements`, `avoir`, `il-y-a`, `daily-routine-present`, `time-expressions`, `possessives`, `adjective-agreement`, `spelling-contact`, `dates-deadlines`, `place-prepositions`, `high-frequency-present`, `health-needs`, `likes-reasons`.

Для каждой темы — 3 новых массива, не пустые (ориентир: 3-6 записей в `paradigm`, 2-4 в `commonMistakes`, 1-3 в `exceptions`; там, где у темы реально нет исключений — например `fixed-phrases` — минимум одна нетривиальная запись всё равно нужна, т.к. поле обязательно: подойдёт нюанс употребления, а не выдуманное «исключение»).

Часть тем описывает не спряжение, а другие виды вариативности — see «Выбранный подход» выше про `label` для не-глагольных тем.

## Рендер / UI

### Справочные страницы (полный набор)

`renderPronunciation` / `renderGrammar` ([app.js:266-299](../../../app.js#L266)):
- каждая карточка (`.phrase-tile`) получает `id="topic-pronunciation-<id>"` / `id="topic-grammar-<id>"` для якорения;
- добавляются три новых блока внутри карточки: таблица `paradigm` (простой `<ul>`/`<table>` вида `label — form`), список `commonMistakes` (зачёркнутое `wrong` → `right` → `note`), список `exceptions` (та же вёрстка).

### Внутри урока (компактная версия, без изменений в объёме)

`renderPronunciationForLesson` / `renderGrammarForLesson` ([app.js:1179-1187](../../../app.js#L1179)) не показывают новые блоки — остаются `cue`/`rule` + примеры как сейчас, плюс добавляется ссылка **«Подробнее →»**.

Клик по ссылке:
1. сохраняет id целевой темы (`pronunciation:<id>` / `grammar:<id>`) во временную переменную модуля (не в `state.appState`, т.к. это одноразовая навигационная подсказка, не персистентный стейт);
2. вызывает `switchView("pronunciation" | "grammar")`;
3. после `render()` — скроллит к `#topic-...` (`scrollIntoView`) и на короткое время добавляет CSS-класс подсветки (например `.topic-highlight`, снимается через `setTimeout`/`animationend`).

## Стили (`styles.css`)

Новые классы: таблица/список `paradigm` (компактная сетка label/form), `.mistake-row` (зачёркнутый `wrong`, стрелка, `right`, `note` мельче), `.topic-highlight` (кратковременная подсветка карточки при переходе по «Подробнее»). Использует существующую цветовую систему тегов (`rose` для произношения, `amber` для грамматики), без новых цветов.

## Тесты

`tests/smoke.mjs` использует `course-validator`/`course-schema` — после бампа `COURSE_SCHEMA_VERSION` и добавления обязательных полей тест должен продолжить проходить без ошибок валидации (наполнение всех тем контентом — часть этой же задачи, не отдельный шаг). Ручная проверка: `node tests/smoke.mjs` после наполнения данных и до правок рендера, чтобы поймать проблемы со схемой отдельно от проблем с UI.

## Миграция

Разовая: правка `data/lessons.json` (наполнение всех 26 тем), `course-schema.js`, `course-validator.js` одним проходом — старых данных, которые нужно было бы конвертировать автоматически, нет (новые поля добавляются, а не заменяют старые).
