# Аудио-кнопки в таблице чтения (Буквы → звук)

## Проблема

В карточке урока произношения (`renderPronunciationLesson`, `app.js:449-456`) таблица "Буквы → звук" показывает паттерн, транскрипцию и слова-примеры, но никак не озвучивается. Нужно добавить две кнопки на строку: одна озвучивает сам звук, вторая — слова-примеры через запятую.

## Ограничение данных

Поле `sound` — IPA-транскрипция в скобках (`[e]`, `[ɥi]`, `обычно [ɛ]`) и не может быть напрямую отправлено в TTS. Поле `pattern` частично состоит из чистых французских буквосочетаний (`"a, à, â"`), но примерно в половине строк это русское описание позиции звука (`"конечные c, r, f, l"`, `"гласная + n/m + гласная"`) — озвучка такого текста французским голосом даёт мусор.

Решение: добавить в данные новое поле `soundText` — вручную выверенный чистый текст без кириллицы для кнопки "звук". Где в паттерне есть буквы — используются буквы (в т.ч. извлечённые из описания: `"конечные c, r, f, l"` → `"c, r, f, l"`). Единственное исключение без явных букв — `read-06` запись 0 (`"гласная + n/m + гласная"`), там нет буквы для озвучки самой позиции, поэтому в качестве soundText берётся первое слово-пример (`"année"`).

## Изменения

### 1. `data/pronunciation-course.json` — добавить `soundText` в каждую запись `spellings`

| lesson | pattern | soundText |
|---|---|---|
| read-01 | a, à, â | a, à, â |
| read-01 | i, y, ï, î | i, y, ï, î |
| read-01 | u, û | u, û |
| read-01 | ou, où, oû, aou, aoû | ou, où, oû, aou, aoû |
| read-02 | é, -er, -ez, et (слово) | é, er, ez, et |
| read-02 | è, ê, ai, aî, ei, est, -et, ey | è, ê, ai, aî, ei, est, et, ey |
| read-02 | e без акцента | e |
| read-02 | o | o |
| read-02 | au, eau, ô | au, eau, ô |
| read-02 | oi, oî | oi, oî |
| read-02 | ui, uî | ui, uî |
| read-02 | eu, œu | eu, œu |
| read-03 | ch | ch |
| read-03 | ph | ph |
| read-03 | gn | gn |
| read-03 | qu | qu |
| read-03 | gu + e/i/y | gu |
| read-03 | il, ill | il, ill |
| read-04 | c + e/i/y | c |
| read-04 | c + a/o/u | c |
| read-04 | ç | ç |
| read-04 | g + e/i/y | g |
| read-04 | g + a/o/u | g |
| read-04 | гласная + s + гласная | s |
| read-04 | ss или s в начале | ss, s |
| read-05 | an, en | an, en |
| read-05 | aon, aen | aon, aen |
| read-05 | am/em + b или p | am, em |
| read-05 | on | on |
| read-05 | om + b или p | om |
| read-05 | in, ain, ein, aim, yn | in, ain, ein, aim, yn |
| read-05 | im/ym + b или p | im, ym |
| read-05 | ien | ien |
| read-05 | un, um | un, um |
| read-06 | гласная + n/m + гласная | année |
| read-06 | nn, mm | nn, mm |
| read-06 | e+mm/e+nn в отдельных словах | emm, enn |
| read-06 | ë и œ без u | ë, œ |
| read-06 | oo и u+m в отдельных заимствованиях | oo, um |
| read-06 | ville, mille, tranquille | ville, mille, tranquille |
| read-06 | ch в отдельных греческих словах | ch |
| read-07 | -e в конце | e |
| read-07 | конечные t, d, p, s | t, d, p, s |
| read-07 | конечные c, r, f, l | c, r, f, l |
| read-07 | -er, -ez | er, ez |
| read-08 | h | h |
| read-08 | l', j', qu', c' | l', j', qu', c' |
| read-08 | s/x + гласная | s, x |
| read-08 | t/d + гласная | t, d |
| read-08 | n + гласная | n |
| read-08 | h muet | h muet |
| read-08 | h aspiré | h aspiré |

52 записи, покрывают все 8 уроков (read-01…read-08).

### 2. `pronunciation-course.js:53` — валидация

Добавить `"soundText"` в список обязательных полей `requireStructuredArray(lesson?.spellings, path, ["pattern", "sound", "examples", "soundText"], errors)`, чтобы отсутствие поля в данных ловилось на этапе загрузки, а не молча рендерилось пустой кнопкой.

### 3. `app.js` — рендер (`renderPronunciationLesson`, строки ~451-455)

В каждую строку `.pronunciation-spelling-row` добавляется блок из двух кнопок:

```html
<div class="pronunciation-sound-actions">
  <button class="inline-audio" type="button" data-speak="${escapeHtml(entry.soundText)}" aria-label="Прослушать звук ${escapeHtml(entry.pattern)}">▶ Звук</button>
  <button class="inline-audio" type="button" data-speak="${escapeHtml(entry.examples)}" aria-label="Прослушать примеры для ${escapeHtml(entry.pattern)}">▶ Слова</button>
</div>
```

Кнопки используют существующий механизм `data-speak` + `bindSpeakButtons()` (уже вызывается после рендера `renderPronunciation`, `app.js:407`) — новой JS-логики озвучки не требуется. `entry.examples` уже хранится как строка через запятую (`"café, parler, nez, et"`), поэтому TTS естественно делает паузы на месте запятых без дополнительной обработки.

### 4. `styles.css` — стили

Добавить `.pronunciation-sound-actions` (flex-ряд с gap) и расширить `.inline-audio`, чтобы кнопка могла содержать текст, а не только иконку-круг (сейчас `.inline-audio` — круглая кнопка 30×30 под один символ `▶`). Для этой таблицы нужен вариант с текстовой подписью — либо модификатор класса (`.inline-audio.labeled`), либо отдельный класс с похожим оформлением (рамка, скруглённые углы, `--accent-dark`).

## Не входит в объём

- Не трогаем остальные вызовы `.inline-audio` (карточки примеров ниже по странице, `app.js:462`) — там уже есть своя круглая кнопка ▶ без изменений.
- Не меняем сам звук/озвучку IPA — `soundText` это осознанное приближение (буквы паттерна), а не попытка синтезировать точный аллофон.
