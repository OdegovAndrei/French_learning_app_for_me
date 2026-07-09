# Дизайн: закрытие уровня A1

Дата: 2026-07-09

## Проблема

`data/lessons.json` содержит только `starter` (11 уроков, Pre-A1/A1: приветствие, знакомство, кафе, магазин, дорога, расписание, помощь, меню, объявление, mini-bilan) и `courseRoadmap` — текстовый план на A1-B2, который ни на что в приложении не влияет (не связан с реальными `levels`/`modules`/`lessons`, не используется в `mastery.js`). README и `courseRoadmap.claimPolicy` честно говорят, что Starter не равен A1.

Конкретные дыры, найденные при разборе `data/lessons.json`, `course-schema.js`, `course-validator.js`, `mastery.js`:

- Из 3 модулей `courseRoadmap.levels[0]` («social-identity», «daily-services», «routines-plans») реально закрыт только первый и часть второго; «routines-plans» не начат.
- Словарь — 45 уникальных слов на весь курс, включая урок «Меню и цены» (`l09`) — там нет ни одного числительного.
- 9 `grammarTopics`: нет `avoir`, `numbers`, `il y a`, распорядка дня, дней недели/time expressions — при том что `numbers` и `il y a` прямо названы в `courseRoadmap.levels[0].modules[1].grammar` (daily-services), а `avoir` нужен для «present tense high-frequency verbs» из `modules[2].grammar` (routines-plans), хоть и не назван по имени.
- Баланс `objectives[].skill` по 11 урокам: `spoken-interaction` 9, `written-production` 6, `spoken-production` 3, `language-system` 3, и по 1 на `mediation`/`reading-reception`/`listening-reception`/`sociolinguistic` — 4 из 7 канонических skill axes почти не имеют доказательств (evidence), а 2 объекта используют **не** канонические id (`reading-reception`, `listening-reception` вместо `reading`/`listening`), плюс один вовсе вне списка (`sociolinguistic`). `course-validator.js` это не ловит: `objective.skill` сверяется только на непустоту текста (`COURSE_SCHEMA.objective`), а не на членство в `courseRoadmap.skillAxes`.
- `scripts/prewarm_tts.py:collect_texts()` (после недавнего TTS-апгрейда) индексирует `targetPhrase`/`dialogue`/`vocabulary`/`pronunciationTopics`, но не `exercise.listenText`/`exercise.transcript` — аудио двух существующих listening/dictation-упражнений (`l10-e1`, `l10-e2`) не закоммичено как статика и идёт через live-fetch/фолбэк, а не через прогретый манифест.

## Выбранный подход

Решения приняты по ходу обсуждения (см. раунды вопросов в сессии):

1. **Строгость** — «практический A1»: закрыть все can-do из `courseRoadmap.levels[0].exitEvidence` по всем 7 skill axes, без имитации формата/хронометража экзамена DELF.
2. **Структура** — новый `level` `a1` (`prerequisites: ["starter"]`) с собственными модулями, а не расширение `starter`. Соответствует уже написанному тексту roadmap, который явно разводит «вводную» и «зачётную» части, и задаёт чистый паттерн для будущего A2 (`level a2`, `prerequisites: ["a1"]`).
3. **Источник контента** — оригинальные авторские диалоги/тексты/словарь, в стиле уже существующих 11 уроков (не адаптация из Tatoeba/TV5MONDE/RFI — они остаются внешними ресурсами в `resources`, не сырьём для контента).
4. **Существующие 11 уроков** — лёгкий ретрофит: id/модули/уровень не трогаем (прогресс не ломается), только чиним 3 некорректных `skill` id и добавляем validator-проверку против будущего дрейфа.
5. **Разрыв по словарю** — 6 уроков, продиктованных только roadmap-модулями (`l12`-`l17`), дают ≈75-85 новых слов, что заметно меньше желаемых 300-400. Решено закрывать добавлением дополнительных уроков (не раздуванием словаря внутри тех же 6 уроков) — отсюда 4-й, бонусный модуль `everyday-life`.

Отклонённый вариант: держать `courseRoadmap` полностью декларативным и добавлять уроки прямо в `starter` — отклонён, так как усиливает уже существующее смешение «вводного» и «зачётного» контента вместо того, чтобы его исправить.

## Архитектура

Новый уровень и 4 модуля добавляются в `levels`/`modules` (тот же формат, что у `starter`):

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

| module id | levelId | roadmap-модуль | order | prerequisites |
|---|---|---|---|---|
| `module:a1:social-identity` | `a1` | `roadmap:a1:social-identity` | 1 | `[]` |
| `module:a1:daily-services` | `a1` | `roadmap:a1:daily-services` | 2 | `["module:a1:social-identity"]` |
| `module:a1:routines-plans` | `a1` | `roadmap:a1:routines-plans` | 3 | `["module:a1:daily-services"]` |
| `module:a1:everyday-life` | `a1` | — (сверх roadmap, явно помечено как бонус) | 4 | `["module:a1:routines-plans"]` |

`module:a1:everyday-life.description` явно фиксирует, что модуль не входит в CEFR-минимум `courseRoadmap` — расширяет словарь, не заявляет дополнительных can-do.

Пререквизиты уроков внутри и между модулями строятся так же, как в `starter`: каждый урок указывает `prerequisites: [<id предыдущего урока>]` (например `l12→l11`, `l13→l12`, ..., первый урок модуля N+1 указывает на последний урок модуля N) — `mastery.checkCatalogLessonPrerequisites` дополнительно прогоняет closure по `module.prerequisites`/`level.prerequisites`, так что уровень `a1` целиком заблокирован, пока не пройден весь `starter`.

## Точечные исправления существующего контента

| Файл | Что | Как |
|---|---|---|
| `data/lessons.json` | `l03` objective `sociolinguistic` | → `spoken-interaction` |
| `data/lessons.json` | `l09` objective `reading-reception` | → `reading` |
| `data/lessons.json` | `l10` objective `listening-reception` | → `listening` |
| `course-validator.js` | `validateCourseRoadmap(roadmap, errors)` (строка 250) сейчас не возвращает `skillAxisIds`, хотя считает их локально (строка 261) | Вернуть `skillAxisIds` из функции; `collectCourseValidationErrors` (строка 37) сохраняет результат и передаёт в цикл по `lesson.objectives` (~строка 141), добавляя проверку `if (hasText(objective.skill) && !skillAxisIds.has(objective.skill)) errors.push(...)` — по образцу уже существующей проверки для `exitEvidence.skill` (строки 296-298). |
| `scripts/prewarm_tts.py` | `collect_texts()` не индексирует текст упражнений | Добавить обход `lesson["exercises"]`, добавлять в `texts` значения `exercise.get("listenText")` и `exercise.get("transcript")`, если есть. |

## Новые уроки (l12-l22)

Формат каждого урока — как у существующих (`id`, `level: "A1"`, `moduleId`, `objectives[].skill` — только канонические id, `dialogue`, `vocabulary`, `exercises` с `objectiveIds`, `cards`). Тексты/словарь/упражнения — предмет отдельного плана реализации, здесь фиксируется только объём и назначение каждого урока.

### `module:a1:social-identity` (доразбор)

| id | Урок | Грамматика/тема | Новый skill-axis evidence | Типы упражнений |
|---|---|---|---|---|
| `l12` | Анкета: имя, страна, язык | nationalities, pays/langue | written-production, reading | guided-writing, reading-comprehension |
| `l13` | Коротко о себе | numbers 0-20 (возраст) | listening, spoken-production | listening-comprehension, recorded-monologue |

### `module:a1:daily-services` (доразбор)

| id | Урок | Грамматика/тема | Новый skill-axis evidence | Типы упражнений |
|---|---|---|---|---|
| `l14` | Числа и время: считаем и планируем | numbers 0-100, `il y a` | language-system | gap-fill, controlled-production |
| `l15` | Часы работы: читаем и объясняем другу | насыщенное объявление/расписание | reading, mediation | reading-comprehension, summarize-for-a-friend |

### `module:a1:routines-plans` (новый, по roadmap)

| id | Урок | Грамматика/тема | Новый skill-axis evidence | Типы упражнений |
|---|---|---|---|---|
| `l16` | Мой обычный день | `avoir`, распорядок (se lever/travailler/se coucher) | spoken-production, language-system | recorded-monologue, sentence-transform |
| `l17` | Дни недели и планы на неделю | days of week, time expressions | written-production, spoken-interaction | message-reply, conversation-prompt |

### `module:a1:everyday-life` (бонус, сверх обязательного минимума roadmap)

| id | Урок | Грамматика/тема | Новый skill-axis evidence | Типы упражнений |
|---|---|---|---|---|
| `l18` | Еда и напитки: рынок | продукты, количества (`un kilo de`...) | reading, language-system | reading-comprehension, gap-fill |
| `l19` | Одежда и погода | `il fait beau/froid`, базовая одежда | listening, spoken-production | listening-comprehension, speaking |
| `l20` | Семья и дом | семья, `mon/ma/mes` | written-production, mediation | guided-writing, summarize-for-a-friend |
| `l21` | Внешность и характер | базовые прилагательные + согласование | language-system, spoken-interaction | sentence-transform, roleplay |
| `l22` | Mini-bilan A1 | сборка: распорядок + встреча + разговор (как `l11` для starter) | spoken-interaction, spoken-production, reading | roleplay, recorded-monologue, reading-comprehension |

### Баланс skill axes (объекты `objectives`, было → станет)

| axis | было | станет |
|---|---|---|
| listening | 1 | 3 |
| reading | 1 | 4 |
| mediation | 1 | 3 |
| spoken-production | 3 | 7 |
| written-production | 6 | 9 |
| language-system | 3 | 7 |
| spoken-interaction | 9 | 12 |

Все 7 осей получают не менее 3 объектов с реальным упражнением-доказательством.

### Словарь

Реалистичная оценка по составу уроков выше (по 12-16 слов на урок, см. пример `l07` — 4 слова на лёгкий урок, но уроки с gap-fill/reading-comprehension вроде `l14`/`l18` вмещают больше): ≈75-85 новых слов от 6 roadmap-уроков (`l12`-`l17`) + ≈50-60 от 4 бонусных (`l18`-`l21`) + минимум от `l22` (mini-bilan, в основном повтор) ⇒ **≈130-150** новых слов, итого course vocabulary ≈**175-195** (сейчас 45). Это ниже изначально названного ориентира 300-400 — озвучено пользователю до фиксации спеки; если после черновика словарь всё ещё покажется скудным, следующий бонусный модуль (досуг/город) добавляется тем же паттерном отдельным раундом, не блокируя текущий.

### Грамматика

Новые `grammarTopics` (9 → 14): `avoir`, `numbers`, `il-y-a`, `daily-routine-present`, `time-expressions`. Новые `pronunciationTopics` не требуются — существующие 5 (`u-y`, `nasals`, `r`, `liaison`, `silent-endings`) покрывают ядро французской фонетики, релевантное новому словарю.

## Аудио

Без изменений в `tts.js`/`app.js`/`server.py` — только процесс: после того как текст уроков `l12`-`l22` дописан в `data/lessons.json` и `scripts/prewarm_tts.py` расширен (см. «Точечные исправления»), прогнать `python3 scripts/prewarm_tts.py`, закоммитить новые `data/audio/*.mp3` и обновлённый `data/audio/manifest.json` — тот же процесс, что и в `9cbf51c`.

## Документация

- `README.md`: список уроков/структура, упоминание объёма курса (`starter` + `a1`, ≈22 урока).
- `data/lessons.json`: `courseRoadmap.levels[0].status` — `"in-progress"` → `"published"` после того, как все уроки `l12`-`l22` добавлены и validator проходит. `claim`-текст не меняется — он и так корректно отделяет «опубликован контент» от «отдельно проверено по CEFR/DELF».

## Тесты

- `tests/smoke.mjs` уже гоняет `validateCourseCatalog(data)` на реальном `data/lessons.json` (строка 19) — новые уровень/модули/уроки и исправленные `skill` id проверяются автоматически, без нового тестового файла.
- Добавить в `tests/smoke.mjs` один synthetic-fixture тест на новую cross-check логику (`objective.skill` не из `skillAxisIds` → ошибка), в стиле уже существующего фикстура `futureLevel` (строка 321).
- `scripts/prewarm_tts.py` покрыт `tests/test_prewarm.py` — при расширении `collect_texts()` тест должен продолжать проходить; при необходимости дополнить его кейсом на `exercise.listenText`.

## Границы (что не входит)

- Не вводится программная привязка `courseRoadmap.levels[].modules[]` к реальным `modules`/`lessons` (никакого нового поля вроде `coveredByLessons`) — соответствие module id по слагу (`social-identity`, `daily-services`, `routines-plans`) остаётся смысловым/документационным, не проверяется кодом. При «практическом A1» это осознанно избыточная строгость.
- Не имитируется формат/хронометраж/шкала баллов DELF A1.
- Не трогаются `l01`-`l11` кроме 3 точечных исправлений `skill` id — тексты, словарь, id, `moduleId` остаются как есть.
- Точные тексты диалогов, словарные статьи, формулировки упражнений — не часть этой спеки, это результат плана реализации (`writing-plans`) и последующего наполнения `data/lessons.json`.
- A2/B1/B2 не затрагиваются.
