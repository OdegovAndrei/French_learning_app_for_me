# Reading-Table Audio Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two audio buttons to every row of the "Буквы → звук" (reading rules) table in the pronunciation-course lesson view: one speaks the letter pattern, one speaks the example words.

**Architecture:** Add a hand-authored `soundText` field to each `spellings` entry in `data/pronunciation-course.json` (clean, TTS-safe text — the IPA `sound` field and many `pattern` strings are not directly speakable). Render two `data-speak` buttons per row using the app's existing speak-button convention (`bindSpeakButtons()` in `app.js`). Extend the project's prewarm pipeline (`scripts/prewarm_tts.py`) so the two new phrases per row get baked into the committed audio cache like every other spoken phrase in the app.

**Tech Stack:** Vanilla JS (ES modules, no bundler/build step), Python 3 (`unittest`/`pytest` for the prewarm script), static JSON data file.

## Global Constraints

- No JS test runner exists in this repo — verify JS/data changes with a one-off `node --input-type=module -e "..."` snippet that imports the real validator, not a permanent test file.
- Python changes use the existing `unittest`-based suite in `tests/` (run via `pytest` or `python -m unittest`).
- `soundText` must never contain Cyrillic characters — it is fed to a French TTS voice.
- Follow the existing `data-speak` attribute + `bindSpeakButtons()` convention already used throughout `app.js` — do not add a new speak-wiring mechanism.
- `data/audio/*.mp3` and `data/audio/manifest.json` are committed to git (see `README.md`) — regenerating them is expected, not a side effect to avoid.

---

### Task 1: Add `soundText` to the reading-rules data and validator

**Files:**
- Modify: `data/pronunciation-course.json:53-58,100-109,168-175,208-216,259-269,322-330,380-385,425-433`
- Modify: `pronunciation-course.js:53`

**Interfaces:**
- Consumes: nothing (pure data + validator change).
- Produces: every object in every lesson's `spellings` array now has a third key `soundText` (string), in addition to the existing `pattern`, `sound`, `examples`. `collectPronunciationCourseErrors` now rejects a `spellings` entry missing `soundText`. Later tasks (2 and 3) read `entry.soundText`.

- [ ] **Step 1: Edit lesson `read-01`'s spellings array**

In `data/pronunciation-course.json`, replace:

```json
      "spellings": [
        { "pattern": "a, à, â", "sound": "[a]", "examples": "ami, là, âge" },
        { "pattern": "i, y, ï, î", "sound": "[i]", "examples": "il, type, naïf, île" },
        { "pattern": "u, û", "sound": "[y]", "examples": "tu, du, sûr" },
        { "pattern": "ou, où, oû, aou, aoû", "sound": "[u]", "examples": "loup, où, croûte, saoul, août" }
      ],
```

with:

```json
      "spellings": [
        { "pattern": "a, à, â", "sound": "[a]", "examples": "ami, là, âge", "soundText": "a, à, â" },
        { "pattern": "i, y, ï, î", "sound": "[i]", "examples": "il, type, naïf, île", "soundText": "i, y, ï, î" },
        { "pattern": "u, û", "sound": "[y]", "examples": "tu, du, sûr", "soundText": "u, û" },
        { "pattern": "ou, où, oû, aou, aoû", "sound": "[u]", "examples": "loup, où, croûte, saoul, août", "soundText": "ou, où, oû, aou, aoû" }
      ],
```

- [ ] **Step 2: Edit lesson `read-02`'s spellings array**

Replace:

```json
      "spellings": [
        { "pattern": "é, -er, -ez, et (слово)", "sound": "[e]", "examples": "café, parler, nez, et" },
        { "pattern": "è, ê, ai, aî, ei, est, -et, ey", "sound": "обычно [ɛ]", "examples": "père, pêche, lait, seize, est, effet, volley" },
        { "pattern": "e без акцента", "sound": "[ə] или [ɛ] по позиции", "examples": "le, petit, sel" },
        { "pattern": "o", "sound": "[o] или [ɔ] по позиции", "examples": "moto, porte" },
        { "pattern": "au, eau, ô", "sound": "[o]", "examples": "auto, bateau, dépôt" },
        { "pattern": "oi, oî", "sound": "[wa]", "examples": "trois, cloître" },
        { "pattern": "ui, uî", "sound": "[ɥi]", "examples": "lui, huître" },
        { "pattern": "eu, œu", "sound": "[ø] или [œ]", "examples": "feu, nœud, neuf" }
      ],
```

with:

```json
      "spellings": [
        { "pattern": "é, -er, -ez, et (слово)", "sound": "[e]", "examples": "café, parler, nez, et", "soundText": "é, er, ez, et" },
        { "pattern": "è, ê, ai, aî, ei, est, -et, ey", "sound": "обычно [ɛ]", "examples": "père, pêche, lait, seize, est, effet, volley", "soundText": "è, ê, ai, aî, ei, est, et, ey" },
        { "pattern": "e без акцента", "sound": "[ə] или [ɛ] по позиции", "examples": "le, petit, sel", "soundText": "e" },
        { "pattern": "o", "sound": "[o] или [ɔ] по позиции", "examples": "moto, porte", "soundText": "o" },
        { "pattern": "au, eau, ô", "sound": "[o]", "examples": "auto, bateau, dépôt", "soundText": "au, eau, ô" },
        { "pattern": "oi, oî", "sound": "[wa]", "examples": "trois, cloître", "soundText": "oi, oî" },
        { "pattern": "ui, uî", "sound": "[ɥi]", "examples": "lui, huître", "soundText": "ui, uî" },
        { "pattern": "eu, œu", "sound": "[ø] или [œ]", "examples": "feu, nœud, neuf", "soundText": "eu, œu" }
      ],
```

- [ ] **Step 3: Edit lesson `read-03`'s spellings array**

Replace:

```json
      "spellings": [
        { "pattern": "ch", "sound": "[ʃ]", "examples": "chat, vache, poche" },
        { "pattern": "ph", "sound": "[f]", "examples": "photo" },
        { "pattern": "gn", "sound": "[ɲ]", "examples": "ligne" },
        { "pattern": "qu", "sound": "[k]", "examples": "qui" },
        { "pattern": "gu + e/i/y", "sound": "[g]", "examples": "guitare, guerre" },
        { "pattern": "il, ill", "sound": "часто [j]", "examples": "travail, travailler, feuille" }
      ],
```

with:

```json
      "spellings": [
        { "pattern": "ch", "sound": "[ʃ]", "examples": "chat, vache, poche", "soundText": "ch" },
        { "pattern": "ph", "sound": "[f]", "examples": "photo", "soundText": "ph" },
        { "pattern": "gn", "sound": "[ɲ]", "examples": "ligne", "soundText": "gn" },
        { "pattern": "qu", "sound": "[k]", "examples": "qui", "soundText": "qu" },
        { "pattern": "gu + e/i/y", "sound": "[g]", "examples": "guitare, guerre", "soundText": "gu" },
        { "pattern": "il, ill", "sound": "часто [j]", "examples": "travail, travailler, feuille", "soundText": "il, ill" }
      ],
```

- [ ] **Step 4: Edit lesson `read-04`'s spellings array**

Replace:

```json
      "spellings": [
        { "pattern": "c + e/i/y", "sound": "[s]", "examples": "merci, cycle" },
        { "pattern": "c + a/o/u", "sound": "[k]", "examples": "café, code, culture" },
        { "pattern": "ç", "sound": "[s]", "examples": "français, garçon" },
        { "pattern": "g + e/i/y", "sound": "[ʒ]", "examples": "page, girafe" },
        { "pattern": "g + a/o/u", "sound": "[g]", "examples": "gare, gomme" },
        { "pattern": "гласная + s + гласная", "sound": "[z]", "examples": "rose, maison" },
        { "pattern": "ss или s в начале", "sound": "[s]", "examples": "poisson, sac" }
      ],
```

with:

```json
      "spellings": [
        { "pattern": "c + e/i/y", "sound": "[s]", "examples": "merci, cycle", "soundText": "c" },
        { "pattern": "c + a/o/u", "sound": "[k]", "examples": "café, code, culture", "soundText": "c" },
        { "pattern": "ç", "sound": "[s]", "examples": "français, garçon", "soundText": "ç" },
        { "pattern": "g + e/i/y", "sound": "[ʒ]", "examples": "page, girafe", "soundText": "g" },
        { "pattern": "g + a/o/u", "sound": "[g]", "examples": "gare, gomme", "soundText": "g" },
        { "pattern": "гласная + s + гласная", "sound": "[z]", "examples": "rose, maison", "soundText": "s" },
        { "pattern": "ss или s в начале", "sound": "[s]", "examples": "poisson, sac", "soundText": "ss, s" }
      ],
```

- [ ] **Step 5: Edit lesson `read-05`'s spellings array**

Replace:

```json
      "spellings": [
        { "pattern": "an, en", "sound": "[ɑ̃]", "examples": "dans, entre" },
        { "pattern": "aon, aen", "sound": "[ɑ̃] в редких словах", "examples": "faon, Caen" },
        { "pattern": "am/em + b или p", "sound": "[ɑ̃]", "examples": "champ, temps" },
        { "pattern": "on", "sound": "[ɔ̃]", "examples": "bon" },
        { "pattern": "om + b или p", "sound": "[ɔ̃]", "examples": "nombre" },
        { "pattern": "in, ain, ein, aim, yn", "sound": "[ɛ̃]", "examples": "pin, pain, plein, faim, synthèse" },
        { "pattern": "im/ym + b или p", "sound": "[ɛ̃]", "examples": "impossible, symbole" },
        { "pattern": "ien", "sound": "[jɛ̃]", "examples": "chien, bien" },
        { "pattern": "un, um", "sound": "[œ̃], часто сливается с [ɛ̃]", "examples": "un, lundi, humble" }
      ],
```

with:

```json
      "spellings": [
        { "pattern": "an, en", "sound": "[ɑ̃]", "examples": "dans, entre", "soundText": "an, en" },
        { "pattern": "aon, aen", "sound": "[ɑ̃] в редких словах", "examples": "faon, Caen", "soundText": "aon, aen" },
        { "pattern": "am/em + b или p", "sound": "[ɑ̃]", "examples": "champ, temps", "soundText": "am, em" },
        { "pattern": "on", "sound": "[ɔ̃]", "examples": "bon", "soundText": "on" },
        { "pattern": "om + b или p", "sound": "[ɔ̃]", "examples": "nombre", "soundText": "om" },
        { "pattern": "in, ain, ein, aim, yn", "sound": "[ɛ̃]", "examples": "pin, pain, plein, faim, synthèse", "soundText": "in, ain, ein, aim, yn" },
        { "pattern": "im/ym + b или p", "sound": "[ɛ̃]", "examples": "impossible, symbole", "soundText": "im, ym" },
        { "pattern": "ien", "sound": "[jɛ̃]", "examples": "chien, bien", "soundText": "ien" },
        { "pattern": "un, um", "sound": "[œ̃], часто сливается с [ɛ̃]", "examples": "un, lundi, humble", "soundText": "un, um" }
      ],
```

- [ ] **Step 6: Edit lesson `read-06`'s spellings array**

Replace:

```json
      "spellings": [
        { "pattern": "гласная + n/m + гласная", "sound": "гласная не носовая, n/m слышно", "examples": "année" },
        { "pattern": "nn, mm", "sound": "гласная не носовая", "examples": "bonne, immense" },
        { "pattern": "e+mm/e+nn в отдельных словах", "sound": "[a]", "examples": "femme, solennel" },
        { "pattern": "ë и œ без u", "sound": "зависит от слова", "examples": "canoë [e], Noël [ɛ], fœtus [e], cœur [œ]" },
        { "pattern": "oo и u+m в отдельных заимствованиях", "sound": "[ɔ]", "examples": "alcool, album" },
        { "pattern": "ville, mille, tranquille", "sound": "[il], не [ij]", "examples": "ville, mille, tranquille" },
        { "pattern": "ch в отдельных греческих словах", "sound": "[k]", "examples": "technique" }
      ],
```

with:

```json
      "spellings": [
        { "pattern": "гласная + n/m + гласная", "sound": "гласная не носовая, n/m слышно", "examples": "année", "soundText": "année" },
        { "pattern": "nn, mm", "sound": "гласная не носовая", "examples": "bonne, immense", "soundText": "nn, mm" },
        { "pattern": "e+mm/e+nn в отдельных словах", "sound": "[a]", "examples": "femme, solennel", "soundText": "emm, enn" },
        { "pattern": "ë и œ без u", "sound": "зависит от слова", "examples": "canoë [e], Noël [ɛ], fœtus [e], cœur [œ]", "soundText": "ë, œ" },
        { "pattern": "oo и u+m в отдельных заимствованиях", "sound": "[ɔ]", "examples": "alcool, album", "soundText": "oo, um" },
        { "pattern": "ville, mille, tranquille", "sound": "[il], не [ij]", "examples": "ville, mille, tranquille", "soundText": "ville, mille, tranquille" },
        { "pattern": "ch в отдельных греческих словах", "sound": "[k]", "examples": "technique", "soundText": "ch" }
      ],
```

- [ ] **Step 7: Edit lesson `read-07`'s spellings array**

Replace:

```json
      "spellings": [
        { "pattern": "-e в конце", "sound": "обычно не произносится", "examples": "ligne, rose" },
        { "pattern": "конечные t, d, p, s", "sound": "обычно не произносятся", "examples": "petit, nid, beaucoup, trois" },
        { "pattern": "конечные c, r, f, l", "sound": "обычно произносятся", "examples": "sac, finir, chef, animal" },
        { "pattern": "-er, -ez", "sound": "[e]", "examples": "parler, nez" }
      ],
```

with:

```json
      "spellings": [
        { "pattern": "-e в конце", "sound": "обычно не произносится", "examples": "ligne, rose", "soundText": "e" },
        { "pattern": "конечные t, d, p, s", "sound": "обычно не произносятся", "examples": "petit, nid, beaucoup, trois", "soundText": "t, d, p, s" },
        { "pattern": "конечные c, r, f, l", "sound": "обычно произносятся", "examples": "sac, finir, chef, animal", "soundText": "c, r, f, l" },
        { "pattern": "-er, -ez", "sound": "[e]", "examples": "parler, nez", "soundText": "er, ez" }
      ],
```

- [ ] **Step 8: Edit lesson `read-08`'s spellings array**

Replace:

```json
      "spellings": [
        { "pattern": "h", "sound": "собственного звука нет", "examples": "hibou, homme, héros" },
        { "pattern": "l’, j’, qu’, c’", "sound": "гласная до апострофа выпала", "examples": "l’ami, j’ai, qu’il, c’est" },
        { "pattern": "s/x + гласная", "sound": "[z] на стыке", "examples": "les amis, deux enfants" },
        { "pattern": "t/d + гласная", "sound": "[t] на стыке", "examples": "c’est ici, grand homme" },
        { "pattern": "n + гласная", "sound": "слышно [n] на стыке", "examples": "un ami" },
        { "pattern": "h muet", "sound": "возможны elision/liaison", "examples": "l’homme, les hommes" },
        { "pattern": "h aspiré", "sound": "стык не связывается", "examples": "le héros, les héros" }
      ],
```

with:

```json
      "spellings": [
        { "pattern": "h", "sound": "собственного звука нет", "examples": "hibou, homme, héros", "soundText": "h" },
        { "pattern": "l’, j’, qu’, c’", "sound": "гласная до апострофа выпала", "examples": "l’ami, j’ai, qu’il, c’est", "soundText": "l’, j’, qu’, c’" },
        { "pattern": "s/x + гласная", "sound": "[z] на стыке", "examples": "les amis, deux enfants", "soundText": "s, x" },
        { "pattern": "t/d + гласная", "sound": "[t] на стыке", "examples": "c’est ici, grand homme", "soundText": "t, d" },
        { "pattern": "n + гласная", "sound": "слышно [n] на стыке", "examples": "un ami", "soundText": "n" },
        { "pattern": "h muet", "sound": "возможны elision/liaison", "examples": "l’homme, les hommes", "soundText": "h muet" },
        { "pattern": "h aspiré", "sound": "стык не связывается", "examples": "le héros, les héros", "soundText": "h aspiré" }
      ],
```

- [ ] **Step 9: Update the validator to require `soundText`**

In `pronunciation-course.js:53`, replace:

```js
    requireStructuredArray(lesson?.spellings, `${path}.spellings`, ["pattern", "sound", "examples"], errors);
```

with:

```js
    requireStructuredArray(lesson?.spellings, `${path}.spellings`, ["pattern", "sound", "examples", "soundText"], errors);
```

- [ ] **Step 10: Verify the data validates and every entry has `soundText`**

Run:

```bash
node --input-type=module -e "
import { collectPronunciationCourseErrors } from './pronunciation-course.js';
import { readFileSync } from 'node:fs';
const course = JSON.parse(readFileSync('data/pronunciation-course.json', 'utf8'));
const errors = collectPronunciationCourseErrors(course);
if (errors.length) { console.error(errors); process.exit(1); }
const total = course.lessons.reduce((sum, l) => sum + l.spellings.length, 0);
const withSoundText = course.lessons.reduce((sum, l) => sum + l.spellings.filter((s) => s.soundText && s.soundText.trim()).length, 0);
console.log(\`entries: \${total}, with soundText: \${withSoundText}\`);
if (total !== withSoundText) process.exit(1);
console.log('OK');
"
```

Expected: prints `entries: 52, with soundText: 52` then `OK`, no errors printed, exit code 0.

- [ ] **Step 11: Commit**

```bash
git add data/pronunciation-course.json pronunciation-course.js
git commit -m "feat: add soundText field to reading-rules spellings data"
```

---

### Task 2: Prewarm the two new spoken phrases per row into the audio cache

**Files:**
- Modify: `scripts/prewarm_tts.py:41-64`
- Modify: `tests/test_prewarm.py`
- Regenerate: `data/audio/manifest.json`, `data/audio/*.mp3` (new files only)

**Interfaces:**
- Consumes: `data/pronunciation-course.json` lessons' `spellings[].soundText` and `spellings[].examples` (produced by Task 1).
- Produces: `data/audio/manifest.json` contains cache-key entries for every `soundText` and `examples` string across all 52 `spellings` rows, with matching `.mp3` files in `data/audio/`. `tts.js`'s `speakFrench` will find these in the manifest instead of falling back to a live `/tts` request.

- [ ] **Step 1: Write the failing test**

In `tests/test_prewarm.py`, add this test to the `CollectTextsTests` class (after `test_collects_independent_pronunciation_course_audio`):

```python
    def test_collects_reading_table_sound_and_example_text(self):
        data = {"lessons": [], "pronunciationTopics": []}
        pronunciation_data = {
            "lessons": [{
                "spellings": [
                    {"pattern": "a, à, â", "sound": "[a]", "examples": "ami, là, âge", "soundText": "a, à, â"},
                    {"pattern": "c + a/o/u", "sound": "[k]", "examples": "café, code, culture", "soundText": "c"}
                ]
            }]
        }
        self.assertEqual(
            prewarm_tts.collect_texts(data, pronunciation_data),
            sorted({"a, à, â", "ami, là, âge", "c", "café, code, culture"})
        )
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_prewarm.py -k test_collects_reading_table_sound_and_example_text -v`
Expected: FAIL — `collect_texts` returns an empty list/without the new strings, since the current implementation never reads `lesson.get("spellings", [])`.

- [ ] **Step 3: Implement the minimal change**

In `scripts/prewarm_tts.py`, inside `collect_texts` (around line 63), replace:

```python
    if pronunciation_data:
        for lesson in pronunciation_data.get("lessons", []):
            for example in lesson.get("examples", []):
                texts.add(example.get("text", ""))
            for card in lesson.get("cards", []):
                texts.add(card.get("audioText", ""))
    return sorted(text for text in texts if text.strip())
```

with:

```python
    if pronunciation_data:
        for lesson in pronunciation_data.get("lessons", []):
            for example in lesson.get("examples", []):
                texts.add(example.get("text", ""))
            for card in lesson.get("cards", []):
                texts.add(card.get("audioText", ""))
            for spelling in lesson.get("spellings", []):
                if spelling.get("soundText"):
                    texts.add(spelling["soundText"])
                if spelling.get("examples"):
                    texts.add(spelling["examples"])
    return sorted(text for text in texts if text.strip())
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_prewarm.py -k test_collects_reading_table_sound_and_example_text -v`
Expected: PASS

- [ ] **Step 5: Run the full prewarm test suite to check nothing else broke**

Run: `.venv/bin/python -m pytest tests/test_prewarm.py -v`
Expected: all tests PASS, including the pre-existing `test_collects_independent_pronunciation_course_audio`.

- [ ] **Step 6: Regenerate the committed audio cache**

Run:

```bash
.venv/bin/python scripts/prewarm_tts.py
```

If this fails because `edge-tts` has no network access in the current environment, fall back to:

```bash
.venv/bin/python scripts/prewarm_tts.py --local-macos
```

Expected: output lines `Synthesizing: <text>` for every new phrase (52 `soundText` values + 52 `examples` strings, minus any that already exist in the manifest from other courses), ending with `Prewarmed <N> phrases into .../data/audio using <source>`. Confirm new `.mp3` files appeared:

```bash
git status --short data/audio/
```

Expected: `data/audio/manifest.json` modified, plus new untracked `.mp3` files.

- [ ] **Step 7: Commit**

```bash
git add scripts/prewarm_tts.py tests/test_prewarm.py data/audio/
git commit -m "feat: prewarm audio cache for reading-table sound and example buttons"
```

---

### Task 3: Render the two audio buttons in the reading table

**Files:**
- Modify: `app.js:449-455`
- Modify: `styles.css` (new rules near `.pronunciation-spelling-row`, currently at line 1329)

**Interfaces:**
- Consumes: `entry.soundText`, `entry.examples` (present on every `spellings` item since Task 1); the existing `escapeHtml` helper, `data-speak` attribute convention, and `bindSpeakButtons()` (already invoked after `renderPronunciation()` at `app.js:407` — no new wiring call needed).
- Produces: two visible buttons per reading-table row: "▶ Звук" (speaks `entry.soundText`) and "▶ Слова" (speaks `entry.examples`).

- [ ] **Step 1: Add the two buttons to the row template**

In `app.js`, replace (currently lines 451-455):

```js
        <div class="paradigm-table pronunciation-pattern-table">${lesson.spellings.map((entry) => `
          <div class="paradigm-row pronunciation-spelling-row">
            <span class="paradigm-label">${escapeHtml(entry.pattern)}</span>
            <span class="paradigm-form"><strong>${escapeHtml(entry.sound)}</strong><br>${escapeHtml(entry.examples)}</span>
          </div>`).join("")}</div>
```

with:

```js
        <div class="paradigm-table pronunciation-pattern-table">${lesson.spellings.map((entry) => `
          <div class="paradigm-row pronunciation-spelling-row">
            <span class="paradigm-label">${escapeHtml(entry.pattern)}</span>
            <span class="paradigm-form"><strong>${escapeHtml(entry.sound)}</strong><br>${escapeHtml(entry.examples)}</span>
            <div class="pronunciation-sound-actions">
              <button class="inline-audio" type="button" data-speak="${escapeHtml(entry.soundText)}" aria-label="Прослушать звук ${escapeHtml(entry.pattern)}">▶ Звук</button>
              <button class="inline-audio" type="button" data-speak="${escapeHtml(entry.examples)}" aria-label="Прослушать примеры для ${escapeHtml(entry.pattern)}">▶ Слова</button>
            </div>
          </div>`).join("")}</div>
```

- [ ] **Step 2: Add CSS for the button row**

In `styles.css`, right after the existing `.pronunciation-spelling-row` rule (line 1329-1331):

```css
.pronunciation-spelling-row {
  grid-template-columns: minmax(110px, 0.8fr) minmax(0, 1.6fr);
}
```

add:

```css
.pronunciation-sound-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: auto;
}

.pronunciation-sound-actions .inline-audio {
  width: auto;
  height: auto;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 800;
  white-space: nowrap;
}
```

- [ ] **Step 3: Verify in the browser**

Start the dev server (`python3 server.py` on port 5173, per project convention — reuse the existing preview dev-server tool), navigate to a pronunciation lesson (e.g. the first "read-01" lesson under the Произношение/reading-rules tab), and confirm:

1. Every row in the "Таблица чтения" section shows two new buttons: "▶ Звук" and "▶ Слова".
2. Clicking "▶ Звук" on the `a, à, â` row plays audio saying "a, à, â".
3. Clicking "▶ Слова" on the same row plays "ami, là, âge" with audible pauses at the commas.
4. Open the Network tab / `read_network_requests`: the audio should load from `data/audio/*.mp3` (the prewarmed files from Task 2), not from a live `/tts?...` request.
5. No console errors after clicking either button.

- [ ] **Step 4: Commit**

```bash
git add app.js styles.css
git commit -m "feat: add sound and example audio buttons to the reading table"
```
