import { buildAnkiTsv } from "./anki.js";
import {
  buildCards,
  buildVocabularyNotes,
  cardsFromVocabularyNote,
  filterCards,
  filterCardsByDirection,
  renderClozeFront,
  revealCloze
} from "./cards.js";
import { checkExercise } from "./exercises.js";
import { validateCourseCatalog } from "./course-validator.js";
import {
  buildPronunciationCards,
  filterPronunciationCards,
  validatePronunciationCourse
} from "./pronunciation-course.js";
import * as mastery from "./mastery.js";
import {
  buildReviewQueue,
  buildUnlockedPhraseRows,
  buildUnlockedWordRows,
  createSchedule,
  isDueSchedule,
  isNewSchedule,
  previewSchedule,
  resetSchedule,
  reviewSchedule
} from "./srs.js";
import {
  clearDatabase,
  deleteRecord,
  exportDatabase,
  getAllRecords,
  getRecord,
  getValue,
  importDatabase,
  initializeFileStorage,
  migrateLegacyProgress,
  putRecord,
  putRecordingResult,
  putReviewResult,
  setValue,
  validateBackup
} from "./storage.js";
import { speakFrench as synthesizeFrench } from "./tts.js";

const app = document.querySelector("#app");
const title = document.querySelector("#view-title");
const modalRoot = document.querySelector("#modal-root");
const saveIndicator = document.querySelector("#save-indicator");

const state = {
  data: null,
  pronunciationData: null,
  view: "today",
  currentLessonId: null,
  pronunciationLessonId: null,
  appState: defaultAppState(),
  pronunciationState: defaultPronunciationState(),
  settings: defaultSettings(),
  customNotes: [],
  schedules: new Map(),
  reviewLogs: [],
  exerciseAttempts: new Map(),
  recordings: new Map(),
  storage: { path: "user-data/french-study-data.json", migratedLocalData: false },
  reviewMode: "review",
  reviewDeck: "all",
  reviewDirection: "ru-fr",
  reviewSeen: new Set(),
  reviewAnswerVisible: false,
  reviewRefreshTimer: null,
  reviewSaving: false,
  pronunciationReviewMode: "review",
  pronunciationReviewDeck: "all",
  pronunciationReviewKind: "all",
  pronunciationReviewSeen: new Set(),
  pronunciationReviewAnswerVisible: false,
  pronunciationReviewSaving: false,
  mediaRecorder: null,
  audioChunks: [],
  recordingContext: null,
  recordingPending: false,
  recordingRequestId: 0,
  audioUrls: new Set(),
  saveTimers: new Map(),
  pendingSaves: new Map(),
  activeSaveCount: 0,
  pendingTopicFocus: null
};

const viewTitles = {
  today: "Сегодня",
  lessons: "Уроки",
  pronunciation: "Правила чтения",
  grammar: "Грамматика",
  vocabulary: "Словарь",
  phrases: "Фразы",
  review: "Повторение",
  "pronunciation-review": "Повторение чтения",
  progress: "Прогресс",
  settings: "Настройки"
};

const MAX_BACKUP_FILE_BYTES = 250 * 1024 * 1024;
const VOICE_OPTIONS = [
  { id: "fr-FR-DeniseNeural", label: "Denise (женский)" },
  { id: "fr-FR-HenriNeural", label: "Henri (мужской)" }
];
const { evaluateLessonReadiness, getIntroducedLessonIds } = mastery;

init();

async function init() {
  try {
    const [response, pronunciationResponse] = await Promise.all([
      fetch("data/lessons.json?v=20260713-vocab-1"),
      fetch("data/pronunciation-course.json?v=20260714-reading-4")
    ]);
    if (!response.ok) throw new Error(`Основной курс: HTTP ${response.status}`);
    if (!pronunciationResponse.ok) throw new Error(`Курс чтения: HTTP ${pronunciationResponse.status}`);
    [state.data, state.pronunciationData] = await Promise.all([response.json(), pronunciationResponse.json()]);
    validateCourseCatalog(state.data);
    validatePronunciationCourse(state.pronunciationData);
    const catalogTitle = state.data.meta?.title || "French Study";
    document.title = catalogTitle;
    state.storage = await initializeFileStorage();
    state.appState = await migrateLegacyProgress(defaultAppState());
    const storedPronunciationState = await getValue("pronunciationState", defaultPronunciationState());
    const pronunciationVersionChanged = storedPronunciationState.contentVersion !== state.pronunciationData.meta.contentVersion;
    state.pronunciationState = normalizePronunciationState(storedPronunciationState);
    if (pronunciationVersionChanged) {
      state.appState.scrollPositions.pronunciation = 0;
      state.appState.scrollPositions["pronunciation-review"] = 0;
      await Promise.all([
        setValue("pronunciationState", state.pronunciationState),
        setValue("appState", state.appState)
      ]);
    }
    const storedSettings = await getValue("settings", {});
    state.settings = { ...defaultSettings(), ...storedSettings };
    if (storedSettings.reviewSettingsVersion !== 1) {
      state.settings.newCardsPerDay = defaultSettings().newCardsPerDay;
      state.settings.reviewSettingsVersion = 1;
      await setValue("settings", state.settings);
    }
    if (!VOICE_OPTIONS.some((option) => option.id === state.settings.voiceURI)) {
      state.settings.voiceURI = defaultSettings().voiceURI;
    }
    state.customNotes = await getAllRecords("vocabulary");
    state.schedules = new Map((await getAllRecords("schedules")).map((item) => [item.id, item]));
    state.reviewLogs = await getAllRecords("reviewLogs");
    state.exerciseAttempts = new Map((await getAllRecords("exercises")).map((item) => [item.id, item]));
    state.recordings = new Map((await getAllRecords("recordings")).map((item) => [item.id, item]));
    await migrateLegacySchedules();

    state.view = viewTitles[state.appState.currentView] ? state.appState.currentView : "today";
    const savedLesson = state.data.lessons.find((lesson) => lesson.id === state.appState.currentLessonId);
    state.currentLessonId =
      (savedLesson
        && !state.appState.completedLessons.includes(savedLesson.id)
        && getLessonPrerequisites(savedLesson).met
        ? savedLesson.id
        : null)
      || getNextLesson()?.id
      || savedLesson?.id
      || state.data.lessons[0]?.id;
    const savedPronunciationLesson = state.pronunciationData.lessons.find(
      (lesson) => lesson.id === state.pronunciationState.currentLessonId
    );
    state.pronunciationLessonId =
      (savedPronunciationLesson
        && !state.pronunciationState.completedLessons.includes(savedPronunciationLesson.id)
        && getPronunciationPrerequisites(savedPronunciationLesson).met
        ? savedPronunciationLesson.id
        : null)
      || getNextPronunciationLesson()?.id
      || savedPronunciationLesson?.id
      || state.pronunciationData.lessons[0]?.id;

    bindGlobalActions();
    render();
    showSaved();
  } catch (error) {
    app.innerHTML = `<div class="empty-state">Не удалось загрузить кабинет: ${escapeHtml(error.message)}</div>`;
  }
}

function bindGlobalActions() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  document.querySelector("#open-settings").addEventListener("click", () => switchView("settings"));
  window.addEventListener("scroll", () => {
    window.clearTimeout(state.scrollTimer);
    state.scrollTimer = window.setTimeout(() => {
      state.appState.scrollPositions[state.view] = window.scrollY;
      saveAppState();
    }, 180);
  });
  window.addEventListener("keydown", handleReviewKeyboard);
  window.addEventListener("focus", refreshReviewOnReturn);
  window.addEventListener("pagehide", () => {
    stopRecording();
    flushPendingSaves();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushPendingSaves();
    } else {
      refreshReviewOnReturn();
    }
  });
}

function switchView(view) {
  stopRecording();
  clearReviewRefreshTimer();
  state.appState.scrollPositions[state.view] = window.scrollY;
  state.view = view;
  state.appState.currentView = view;
  state.reviewSeen.clear();
  state.reviewAnswerVisible = false;
  state.pronunciationReviewSeen.clear();
  state.pronunciationReviewAnswerVisible = false;
  saveAppState();
  render();
}

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
    phrases: renderPhrases,
    review: renderReview,
    "pronunciation-review": renderPronunciationReview,
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

function renderToday() {
  const current = state.data.lessons.find((lesson) => lesson.id === state.currentLessonId);
  const lesson = current
    && !state.appState.completedLessons.includes(current.id)
    && getLessonPrerequisites(current).met
    ? current
    : getNextLesson() || current || state.data.lessons[0];
  if (state.currentLessonId !== lesson.id) setCurrentLesson(lesson.id);
  const reviewInfo = getReviewSummary();
  app.innerHTML = `
    <div class="metrics-grid today-metrics">
      <button class="metric metric-button" type="button" data-go-review>
        <p class="eyebrow">Повторение</p>
        <strong>${reviewInfo.due} к повторению</strong>
        <span>${reviewInfo.newSlots} новых сегодня</span>
      </button>
      <div class="metric">
        <p class="eyebrow">Текущий урок</p>
        <strong>${escapeHtml(lesson.level)} · ${escapeHtml(lesson.title)}</strong>
        <span>Прогресс сохраняется автоматически</span>
      </div>
    </div>
    <div class="dashboard-grid with-top-gap">
      <div id="today-lesson"></div>
      <aside class="section-band daily-plan">
        <div class="section-heading"><div><p class="eyebrow">45-60 минут</p><h4>Распорядок дня</h4></div></div>
        <ol class="example-list">
          <li>5 минут: карточки, которые пора повторить.</li>
          <li>10 минут: новый мини-диалог.</li>
          <li>5-10 минут: звук или правило чтения.</li>
          <li>10 минут: мини-грамматика из диалога.</li>
          <li>10 минут: упражнения с проверкой.</li>
          <li>5-10 минут: запись голоса.</li>
        </ol>
        <button class="secondary-button full-button" type="button" data-go-review>Начать повторение</button>
      </aside>
    </div>
    ${renderResources()}`;
  renderLessonInto(document.querySelector("#today-lesson"), lesson);
  document.querySelectorAll("[data-go-review]").forEach((button) => {
    button.addEventListener("click", () => switchView("review"));
  });
}

function renderLessons() {
  const groups = buildLessonGroups();
  app.innerHTML = `
    <section class="section-band">
      <div class="section-heading"><div><p class="eyebrow">Starter · путь по модулям</p><h4>Выбери доступный урок</h4></div></div>
      <div class="course-map">
        ${groups.map((levelGroup) => `
          <section class="course-level-group" aria-labelledby="level-${escapeHtml(levelGroup.id)}">
            <header class="course-group-heading">
              <span class="tag">${escapeHtml(levelGroup.id)}</span>
              <div><h4 id="level-${escapeHtml(levelGroup.id)}">${escapeHtml(levelGroup.title)}</h4>${levelGroup.description ? `<p class="note">${escapeHtml(levelGroup.description)}</p>` : ""}</div>
            </header>
            ${levelGroup.modules.map((module) => `
              <section class="course-module" aria-labelledby="module-${escapeHtml(module.id)}">
                <div class="section-heading"><div><p class="eyebrow">Модуль</p><h5 id="module-${escapeHtml(module.id)}" class="compact-title">${escapeHtml(module.title)}</h5>${module.description ? `<p class="note">${escapeHtml(module.description)}</p>` : ""}</div></div>
                <div class="lesson-grid">${module.lessons.map(renderLessonTile).join("")}</div>
              </section>`).join("")}
          </section>`).join("")}
      </div>
    </section>
    ${renderCourseRoadmap()}
    <div id="selected-lesson" class="lesson-layout with-top-gap"></div>`;
  document.querySelectorAll(".lesson-tile").forEach((button) => {
    button.addEventListener("click", () => {
      const lesson = getLesson(button.dataset.lessonId);
      setCurrentLesson(lesson.id);
      state.appState.scrollPositions.lessons = 0;
      renderLessons();
    });
  });
  document.querySelectorAll("[data-toggle-complete]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleLessonCompleteFromTile(button.dataset.toggleComplete);
    });
  });
  const selected = getLesson(state.currentLessonId);
  const container = document.querySelector("#selected-lesson");
  renderLessonInto(container, selected);
}

function renderParadigm(paradigm) {
  return `<div class="paradigm-table">${paradigm.map((entry) => `<div class="paradigm-row"><span class="paradigm-label">${escapeHtml(entry.label)}</span><span class="paradigm-form">${escapeHtml(entry.form)}</span></div>`).join("")}</div>`;
}

function renderMistakeBlock(heading, items) {
  return `<div class="mistake-list"><p class="mistake-list-heading">${escapeHtml(heading)}</p>${items.map((entry) => `<div class="mistake-row"><span class="mistake-wrong">${escapeHtml(entry.wrong)}</span><span class="mistake-arrow">→</span><span class="mistake-right">${escapeHtml(entry.right)}</span><span class="mistake-note">${escapeHtml(entry.note)}</span></div>`).join("")}</div>`;
}

function renderPronunciation() {
  const completed = new Set(state.pronunciationState.completedLessons);
  const selected = getPronunciationLesson(state.pronunciationLessonId);
  const modules = [...state.pronunciationData.modules].sort(compareOrder);
  app.innerHTML = `
    <section class="section-band">
      <div class="section-heading pronunciation-course-heading">
        <div>
          <p class="eyebrow">Независимый курс · ${completed.size}/${state.pronunciationData.lessons.length} уроков</p>
          <h4>${escapeHtml(state.pronunciationData.meta.title)}</h4>
          <p class="note">${escapeHtml(state.pronunciationData.meta.method)}. ${escapeHtml(state.pronunciationData.meta.cardMethod)}. Прогресс и карточки не зависят от основного курса.</p>
        </div>
        <button class="primary-button" type="button" id="open-pronunciation-review">Повторять чтение</button>
      </div>
      <div class="pronunciation-module-list">
        ${modules.map((module) => {
          const lessons = state.pronunciationData.lessons.filter((lesson) => lesson.moduleId === module.id).sort(compareOrder);
          const moduleCompleted = lessons.filter((lesson) => completed.has(lesson.id)).length;
          return `
            <section class="course-module" aria-labelledby="pronunciation-module-${escapeHtml(module.id)}">
              <div class="section-heading">
                <div>
                  <p class="eyebrow">Модуль ${module.order} · ${moduleCompleted}/${lessons.length}</p>
                  <h5 id="pronunciation-module-${escapeHtml(module.id)}" class="compact-title">${escapeHtml(module.title)}</h5>
                  <p class="note">${escapeHtml(module.description)}</p>
                </div>
              </div>
              <div class="lesson-grid pronunciation-lesson-grid">
                ${lessons.map((lesson) => renderPronunciationLessonTile(lesson, completed)).join("")}
              </div>
            </section>`;
        }).join("")}
      </div>
    </section>`;

  app.insertAdjacentHTML("beforeend", renderPronunciationLesson(selected));
  app.insertAdjacentHTML("beforeend", renderPronunciationReference());

  document.querySelector("#open-pronunciation-review").addEventListener("click", () => switchView("pronunciation-review"));
  document.querySelectorAll("[data-pronunciation-lesson]").forEach((button) => {
    button.addEventListener("click", async () => {
      setCurrentPronunciationLesson(button.dataset.pronunciationLesson);
      state.appState.scrollPositions.pronunciation = 0;
      await savePronunciationState();
      renderPronunciation();
    });
  });
  document.querySelector("#complete-pronunciation-lesson")?.addEventListener("click", () => completePronunciationLesson(selected.id));
  bindSpeakButtons();
  bindVoiceLabs();
}

function renderPronunciationLessonTile(lesson, completed) {
  const prerequisites = getPronunciationPrerequisites(lesson);
  const done = completed.has(lesson.id);
  const selected = state.pronunciationLessonId === lesson.id;
  return `
    <button class="lesson-tile pronunciation-lesson-tile ${done ? "completed" : ""} ${selected ? "selected" : ""}" type="button"
      data-pronunciation-lesson="${escapeHtml(lesson.id)}" ${prerequisites.met ? "" : "disabled"}>
      <span class="tag ${done ? "rose" : ""}">${done ? "готово" : `урок ${lesson.order}`}</span>
      <strong>${escapeHtml(lesson.title)}</strong>
      <span class="fr">${escapeHtml(lesson.target)}</span>
      <span class="note">${prerequisites.met ? escapeHtml(lesson.goal) : `Сначала: ${escapeHtml(prerequisites.missing.join(", "))}`}</span>
    </button>`;
}

function renderPronunciationLesson(lesson) {
  const done = state.pronunciationState.completedLessons.includes(lesson.id);
  const module = state.pronunciationData.modules.find((item) => item.id === lesson.moduleId);
  const cardCount = lesson.cards.length;
  return `
    <article class="lesson-layout pronunciation-lesson-detail with-top-gap" id="selected-pronunciation-lesson">
      <header class="lesson-hero">
        <div>
          <p class="eyebrow">${escapeHtml(module?.title || "Правила чтения")} · урок ${lesson.order}</p>
          <h3>${escapeHtml(lesson.title)}</h3>
          <p>${escapeHtml(lesson.goal)}</p>
          <div class="tag-row">${lesson.focus.map((item) => `<span class="tag rose">${escapeHtml(item)}</span>`).join("")}</div>
        </div>
        <div class="lesson-actions">
          <button class="primary-button" id="complete-pronunciation-lesson" type="button" ${done ? "disabled" : ""}>${done ? "Урок пройден" : "Завершить урок"}</button>
          <p class="completion-status">${done ? "Правила урока открыты в повторении чтения." : `После завершения откроются карточки урока: ${cardCount}.`}</p>
        </div>
      </header>

      <section class="section-band">
        <div class="section-heading"><div><p class="eyebrow">Главное правило</p><h4>${escapeHtml(lesson.target)}</h4></div></div>
        <p class="grammar-rule pronunciation-rule">${escapeHtml(lesson.rule)}</p>
      </section>

      <section class="section-band">
        <div class="section-heading"><div><p class="eyebrow">Буквы → звук</p><h4>Таблица чтения</h4></div></div>
        <div class="paradigm-table pronunciation-pattern-table">${lesson.spellings.map((entry) => `
          <div class="paradigm-row pronunciation-spelling-row">
            <span class="paradigm-label">${escapeHtml(entry.pattern)}</span>
            <span class="paradigm-form"><strong>${escapeHtml(entry.sound)}</strong><br>${escapeHtml(entry.examples)}</span>
          </div>`).join("")}</div>
      </section>

      <section class="section-band">
        <div class="section-heading"><div><p class="eyebrow">Сочетание → слово</p><h4>Разбираем примеры</h4></div></div>
        <div class="pronunciation-example-grid">${lesson.examples.map((example) => `
          <article class="pronunciation-example">
            <button class="inline-audio" type="button" data-speak="${escapeHtml(example.text)}" aria-label="Прослушать ${escapeHtml(example.text)}">▶</button>
            <strong class="fr">${escapeHtml(example.text)}</strong>
            <span class="ipa">${escapeHtml(example.ipa)}</span>
            <p class="note">${escapeHtml(example.note)}</p>
          </article>`).join("")}</div>
      </section>

      <section class="section-band">
        <div class="section-heading"><div><p class="eyebrow">Мини-практика</p><h4>От блока к целому</h4></div></div>
        <ol class="example-list pronunciation-reading-steps">${lesson.practice.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>
      </section>
    </article>`;
}

function renderPronunciationReference() {
  return `
    <details class="section-band with-top-gap pronunciation-reference" ${state.pendingTopicFocus?.startsWith("topic-pronunciation-") ? "open" : ""}>
      <summary><strong>Краткий справочник основного курса</strong> · ${state.data.pronunciationTopics.length} тем</summary>
      <div class="phrase-grid with-top-gap">
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
    </details>`;
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

function renderVocabulary() {
  const notes = getVocabularyNotes();
  app.innerHTML = `
    <section class="section-band">
      <div class="section-heading vocab-heading">
        <div><p class="eyebrow">${notes.length} записей · ${getAllCards().length} карточек</p><h4>Словарь и свои слова</h4></div>
        <div class="control-row">
          <input class="search-input" type="search" id="vocab-search" placeholder="Поиск по словарю" />
          <button class="primary-button" type="button" id="add-word">Добавить слово</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="vocab-table">
          <thead><tr><th>Французский</th><th>IPA</th><th>Значение</th><th>Источник</th><th></th></tr></thead>
          <tbody id="vocab-body">${notes.map(renderVocabRow).join("")}</tbody>
        </table>
      </div>
    </section>`;

  document.querySelector("#add-word").addEventListener("click", () => openWordDialog());
  bindVocabularyActions();
  document.querySelector("#vocab-search").addEventListener("input", (event) => {
    const query = event.target.value.trim().toLocaleLowerCase("fr");
    const filtered = notes.filter((note) =>
      [note.fr, note.ru, note.ipa, note.note, note.lessonTitle, ...(note.tags || [])]
        .join(" ")
        .toLocaleLowerCase("fr")
        .includes(query)
    );
    document.querySelector("#vocab-body").innerHTML = filtered.map(renderVocabRow).join("");
    bindVocabularyActions();
  });
}

function renderPhrases() {
  const phraseCards = filterCards(getActiveCards(), "phrases");
  const rows = buildUnlockedPhraseRows({ cards: phraseCards, schedules: state.schedules, now: new Date() });

  app.innerHTML = `
    <section class="section-band">
      <div class="section-heading vocab-heading">
        <div>
          <p class="eyebrow">${rows.length} фраз · ${phraseCards.length} карточек</p>
          <h4>Фразы из пройденных уроков</h4>
          <p class="note">Полные реплики диалогов открываются вместе со словами урока. Для каждой фразы есть карточки в обе стороны, а расписание ведёт тот же FSRS.</p>
        </div>
        <button class="primary-button" type="button" id="review-phrases">Повторять фразы</button>
      </div>
      ${renderUnlockedPhrasesList(phraseCards, rows)}
    </section>`;

  document.querySelector("#review-phrases").addEventListener("click", () => {
    state.reviewDeck = "phrases";
    state.reviewMode = "review";
    switchView("review");
  });
  document.querySelectorAll("[data-phrase-speak]").forEach((button) => {
    button.addEventListener("click", () => speakFrench(button.dataset.phraseSpeak));
  });
}

function renderReview() {
  const allCards = getAllCards();
  const allActive = getActiveCards();
  const suspendedCards = allCards.filter((card) => state.appState.suspendedCardIds.includes(card.id));
  const deckCards = filterCardsByDirection(filterCards(allActive, state.reviewDeck), state.reviewDirection);
  const isWordsMode = state.reviewMode === "words";
  const isPhrasesDeck = state.reviewDeck === "phrases";
  let queue = isWordsMode ? [] : buildReviewQueue({
    cards: deckCards,
    schedules: state.schedules,
    logs: state.reviewLogs,
    newLimit: state.settings.newCardsPerDay,
    cram: state.reviewMode === "cram",
    seen: state.reviewSeen
  });
  const summary = getReviewSummary(deckCards);
  if (!isWordsMode && !queue.length && summary.due > 0 && state.reviewSeen.size > 0) {
    state.reviewSeen.clear();
    queue = buildReviewQueue({
      cards: deckCards,
      schedules: state.schedules,
      logs: state.reviewLogs,
      newLimit: state.settings.newCardsPerDay,
      cram: state.reviewMode === "cram",
      seen: state.reviewSeen
    });
  }
  const card = queue[0];

  app.innerHTML = `
    <section class="review-stage">
      <div class="review-toolbar">
        <div class="segmented" aria-label="Режим повторения">
          <button type="button" data-review-mode="review" class="${state.reviewMode === "review" ? "active" : ""}">Повторение</button>
          <button type="button" data-review-mode="cram" class="${state.reviewMode === "cram" ? "active" : ""}">Зубрёжка</button>
          <button type="button" data-review-mode="words" class="${isWordsMode ? "active" : ""}">${isPhrasesDeck ? "Все фразы" : "Все слова"}</button>
        </div>
        <div class="segmented" aria-label="Направление">
          <button type="button" data-review-direction="ru-fr" class="${state.reviewDirection === "ru-fr" ? "active" : ""}">RU → FR</button>
          <button type="button" data-review-direction="fr-ru" class="${state.reviewDirection === "fr-ru" ? "active" : ""}">FR → RU</button>
        </div>
        ${isWordsMode ? "" : `
        <select id="review-deck" class="select-control" aria-label="Колода">
          ${renderDeckOptions()}
        </select>`}
        <button class="secondary-button" type="button" id="review-add-word">Добавить слово</button>
      </div>
      ${isWordsMode ? "" : `
      <div class="review-counters">
        <span><strong>${summary.due}</strong> пора</span>
        <span><strong>${summary.newCount}</strong> новых</span>
        <span><strong>${queue.length}</strong> в этой сессии</span>
      </div>`}
      ${isWordsMode ? (isPhrasesDeck ? renderUnlockedPhrasesList(deckCards) : renderUnlockedWordsList(deckCards)) : (card ? renderReviewCard(card) : renderReviewEmpty(summary))}
      ${renderSuspendedCards(suspendedCards)}
    </section>`;

  bindReviewToolbar();
  if (!isWordsMode && card) bindReviewCard(card);
  scheduleReviewRefresh(deckCards);
}

function renderPronunciationReview() {
  const allCards = buildPronunciationCards(state.pronunciationData);
  const activeCards = getActivePronunciationCards(allCards);
  const suspendedCards = allCards.filter((card) => state.pronunciationState.suspendedCardIds.includes(card.id));
  const deckCards = filterPronunciationCards(activeCards, {
    deck: state.pronunciationReviewDeck,
    kind: state.pronunciationReviewKind
  });
  const cardIds = new Set(allCards.map((card) => card.id));
  const pronunciationLogs = state.reviewLogs.filter((log) => cardIds.has(log.cardId));
  const isCatalog = state.pronunciationReviewMode === "catalog";
  let queue = isCatalog ? [] : buildReviewQueue({
    cards: deckCards,
    schedules: state.schedules,
    logs: pronunciationLogs,
    newLimit: state.settings.pronunciationNewCardsPerDay,
    cram: state.pronunciationReviewMode === "cram",
    seen: state.pronunciationReviewSeen
  });
  const summary = getPronunciationReviewSummary(deckCards, pronunciationLogs);
  if (!isCatalog && !queue.length && summary.due > 0 && state.pronunciationReviewSeen.size > 0) {
    state.pronunciationReviewSeen.clear();
    queue = buildReviewQueue({
      cards: deckCards,
      schedules: state.schedules,
      logs: pronunciationLogs,
      newLimit: state.settings.pronunciationNewCardsPerDay,
      cram: state.pronunciationReviewMode === "cram",
      seen: state.pronunciationReviewSeen
    });
  }
  const card = queue[0];

  app.innerHTML = `
    <section class="review-stage pronunciation-review-stage">
      <div class="review-toolbar pronunciation-review-toolbar">
        <div class="segmented" aria-label="Режим повторения чтения">
          <button type="button" data-pronunciation-review-mode="review" class="${state.pronunciationReviewMode === "review" ? "active" : ""}">Повторение</button>
          <button type="button" data-pronunciation-review-mode="cram" class="${state.pronunciationReviewMode === "cram" ? "active" : ""}">Зубрёжка</button>
          <button type="button" data-pronunciation-review-mode="catalog" class="${isCatalog ? "active" : ""}">Все карточки</button>
        </div>
        <select id="pronunciation-review-kind" class="select-control" aria-label="Тип карточки">
          ${pronunciationKindOptions()}
        </select>
        <select id="pronunciation-review-deck" class="select-control" aria-label="Раздел правил чтения">
          ${renderPronunciationDeckOptions()}
        </select>
        <button class="secondary-button" type="button" id="back-to-pronunciation-course">К урокам</button>
      </div>
      ${isCatalog ? "" : `
        <div class="review-counters">
          <span><strong>${summary.due}</strong> пора</span>
          <span><strong>${summary.newCount}</strong> новых</span>
          <span><strong>${queue.length}</strong> в этой сессии</span>
        </div>`}
      ${isCatalog
        ? renderPronunciationCardCatalog(deckCards)
        : (card ? renderPronunciationReviewCard(card) : renderPronunciationReviewEmpty(summary, activeCards.length))}
      ${renderSuspendedPronunciationCards(suspendedCards)}
    </section>`;

  bindPronunciationReviewToolbar();
  if (!isCatalog && card) bindPronunciationReviewCard(card);
  document.querySelectorAll("[data-pronunciation-catalog-speak]").forEach((button) => {
    button.addEventListener("click", () => speakFrench(button.dataset.pronunciationCatalogSpeak));
  });
  schedulePronunciationReviewRefresh(deckCards);
}

function renderPronunciationReviewCard(card) {
  const schedule = state.schedules.get(card.id) || createSchedule(card.id);
  const preview = state.pronunciationReviewMode === "cram"
    ? Object.fromEntries(["again", "hard", "good", "easy"].map((rating) => [rating, { interval: "без изменения графика" }]))
    : previewSchedule(schedule);
  return `
    <article class="review-card pronunciation-review-card" data-card-id="${escapeHtml(card.id)}">
      <div class="review-context">${escapeHtml(card.moduleTitle)} · ${escapeHtml(pronunciationKindLabel(card.kind))}</div>
      <div class="review-front">${nl2br(card.prompt)}</div>
      <div class="control-row review-primary-actions">
        ${state.pronunciationReviewAnswerVisible ? "" : `<button class="primary-button" type="button" id="show-answer">Показать ответ</button>`}
      </div>
      ${state.pronunciationReviewAnswerVisible ? `
        <div class="review-back visible">
          <p class="fr">${nl2br(card.answer)}</p>
          <p class="note">${escapeHtml(card.explanation)}</p>
          <button class="icon-text-button" type="button" data-pronunciation-card-speak>▶ Проверить по аудио</button>
          <div class="rating-grid">
            ${renderRatingButton("again", "Again", preview.again.interval)}
            ${renderRatingButton("hard", "Hard", preview.hard.interval)}
            ${renderRatingButton("good", "Good", preview.good.interval)}
            ${renderRatingButton("easy", "Easy", preview.easy.interval)}
          </div>
        </div>` : ""}
      <div class="review-card-tools">
        <button type="button" data-pronunciation-card-skip>В конец очереди</button>
        <button type="button" data-pronunciation-card-reset>Сбросить карточку</button>
        <button type="button" data-pronunciation-card-suspend>Приостановить</button>
      </div>
    </article>`;
}

function renderPronunciationCardCatalog(cards) {
  if (!cards.length) {
    return `<div class="empty-state"><strong>Нет открытых карточек этого типа</strong><p>Заверши соответствующий урок чтения или измени фильтр.</p></div>`;
  }
  const groups = new Map();
  for (const card of cards) {
    if (!groups.has(card.lessonId)) groups.set(card.lessonId, { title: card.lessonTitle, cards: [] });
    groups.get(card.lessonId).cards.push(card);
  }
  return `<div class="pronunciation-card-catalog">${[...groups.values()].map((group) => `
    <section class="section-band">
      <div class="section-heading"><div><p class="eyebrow">${group.cards.length} карточки</p><h4>${escapeHtml(group.title)}</h4></div></div>
      <div class="history-list">${group.cards.map((card) => `
        <div class="history-row pronunciation-catalog-row">
          <span class="tag rose">${escapeHtml(pronunciationKindLabel(card.kind))}</span>
          <strong>${escapeHtml(card.prompt)}</strong>
          <span>${escapeHtml(card.answer)}</span>
          <button class="secondary-button" type="button" data-pronunciation-catalog-speak="${escapeHtml(card.audioText)}">▶</button>
        </div>`).join("")}</div>
    </section>`).join("")}</div>`;
}

function renderPronunciationReviewEmpty(summary, activeCount) {
  if (!activeCount) {
    return `<div class="empty-state"><strong>Карточки ещё не открыты</strong><p>Заверши первый урок чтения — обычные уроки на эту колоду не влияют.</p><button class="primary-button" type="button" id="start-pronunciation-course">Открыть курс</button></div>`;
  }
  return `<div class="empty-state"><strong>${state.pronunciationReviewMode === "cram" ? "Колода закончилась" : "На сегодня всё"}</strong><p>${summary.newCount ? "Новые карточки появятся после увеличения отдельного дневного лимита или завтра." : "Можно открыть каталог или продолжить курс чтения."}</p></div>`;
}

function renderSuspendedPronunciationCards(cards) {
  if (!cards.length) return "";
  return `
    <details class="with-top-gap">
      <summary>Приостановленные карточки чтения (${cards.length})</summary>
      <div class="history-list with-top-gap">${cards.map((card) => `
        <div class="history-row">
          <strong>${escapeHtml(card.prompt)}</strong>
          <span>${escapeHtml(card.lessonTitle)}</span>
          <button class="secondary-button" type="button" data-pronunciation-card-resume="${escapeHtml(card.id)}">Вернуть</button>
        </div>`).join("")}</div>
    </details>`;
}

function bindPronunciationReviewToolbar() {
  document.querySelectorAll("[data-pronunciation-review-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.pronunciationReviewMode = button.dataset.pronunciationReviewMode;
      state.pronunciationReviewSeen.clear();
      state.pronunciationReviewAnswerVisible = false;
      renderPronunciationReview();
    });
  });
  document.querySelector("#pronunciation-review-kind")?.addEventListener("change", (event) => {
    state.pronunciationReviewKind = event.target.value;
    state.pronunciationReviewSeen.clear();
    state.pronunciationReviewAnswerVisible = false;
    renderPronunciationReview();
  });
  document.querySelector("#pronunciation-review-deck")?.addEventListener("change", (event) => {
    state.pronunciationReviewDeck = event.target.value;
    state.pronunciationReviewSeen.clear();
    state.pronunciationReviewAnswerVisible = false;
    renderPronunciationReview();
  });
  document.querySelector("#back-to-pronunciation-course")?.addEventListener("click", () => switchView("pronunciation"));
  document.querySelector("#start-pronunciation-course")?.addEventListener("click", () => switchView("pronunciation"));
  document.querySelectorAll("[data-pronunciation-card-resume]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.pronunciationState.suspendedCardIds = state.pronunciationState.suspendedCardIds.filter(
        (id) => id !== button.dataset.pronunciationCardResume
      );
      await savePronunciationState();
      renderPronunciationReview();
    });
  });
}

function bindPronunciationReviewCard(card) {
  document.querySelector("#show-answer")?.addEventListener("click", () => {
    state.pronunciationReviewAnswerVisible = true;
    renderPronunciationReview();
  });
  document.querySelector("[data-pronunciation-card-speak]")?.addEventListener("click", () => speakFrench(card.audioText));
  document.querySelectorAll("[data-score]").forEach((button) => {
    button.addEventListener("click", () => gradePronunciationReviewCard(card, button.dataset.score));
  });
  document.querySelector("[data-pronunciation-card-skip]").addEventListener("click", () => {
    state.pronunciationReviewSeen.add(card.id);
    state.pronunciationReviewAnswerVisible = false;
    renderPronunciationReview();
  });
  document.querySelector("[data-pronunciation-card-reset]").addEventListener("click", async () => {
    const schedule = resetSchedule(card.id);
    state.schedules.set(card.id, schedule);
    await putRecord("schedules", schedule);
    state.pronunciationReviewSeen.add(card.id);
    state.pronunciationReviewAnswerVisible = false;
    renderPronunciationReview();
  });
  document.querySelector("[data-pronunciation-card-suspend]").addEventListener("click", async () => {
    if (!state.pronunciationState.suspendedCardIds.includes(card.id)) {
      state.pronunciationState.suspendedCardIds.push(card.id);
    }
    await savePronunciationState();
    state.pronunciationReviewAnswerVisible = false;
    renderPronunciationReview();
  });
}

async function gradePronunciationReviewCard(card, rating) {
  if (state.pronunciationReviewSaving) return;
  if (state.pronunciationReviewMode === "cram") {
    state.pronunciationReviewSeen.add(card.id);
    state.pronunciationReviewAnswerVisible = false;
    renderPronunciationReview();
    return;
  }
  state.pronunciationReviewSaving = true;
  showSaving();
  const schedule = state.schedules.get(card.id) || createSchedule(card.id);
  const { schedule: nextSchedule, log } = reviewSchedule(schedule, rating);
  log.id = `${card.id}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  try {
    await putReviewResult(nextSchedule, log);
    state.schedules.set(card.id, nextSchedule);
    state.reviewLogs.push(log);
    state.pronunciationReviewAnswerVisible = false;
    showSaved();
    renderPronunciationReview();
  } catch (error) {
    showSaveError(error);
  } finally {
    state.pronunciationReviewSaving = false;
  }
}

function renderUnlockedWordsList(cards) {
  const rows = buildUnlockedWordRows({ cards, schedules: state.schedules, now: new Date() });
  if (!rows.length) {
    return `<div class="empty-state"><strong>Пока нет разблокированных слов</strong><p>Пройди урок или добавь своё слово, чтобы они появились здесь.</p></div>`;
  }
  const groups = [];
  for (const row of rows) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.label === row.groupLabel) {
      lastGroup.rows.push(row);
    } else {
      groups.push({ label: row.groupLabel, rows: [row] });
    }
  }
  return `
    <div class="unlocked-words-groups">
      ${groups.map((group) => `
        <section class="section-band with-top-gap">
          <div class="section-heading"><div><p class="eyebrow">${group.rows.length} слов</p><h4>${escapeHtml(group.label)}</h4></div></div>
          <div class="table-wrap">
            <table class="vocab-table">
              <thead><tr><th>Французский</th><th>Перевод</th><th>Статус</th><th>Осталось до показа</th></tr></thead>
              <tbody>
                ${group.rows.map((row) => `
                  <tr>
                    <td><strong>${escapeHtml(row.front)}</strong></td>
                    <td>${escapeHtml(row.back)}</td>
                    <td>${escapeHtml(row.statusLabel)}</td>
                    <td>${escapeHtml(row.remainingLabel)}</td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>
        </section>`).join("")}
    </div>`;
}

function groupPhraseRows(rows) {
  const groups = [];
  for (const row of rows) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.label === row.groupLabel) {
      lastGroup.rows.push(row);
    } else {
      groups.push({ label: row.groupLabel, rows: [row] });
    }
  }
  return groups;
}

function renderUnlockedPhrasesList(cards, existingRows = null) {
  const rows = existingRows || buildUnlockedPhraseRows({ cards, schedules: state.schedules, now: new Date() });
  if (!rows.length) {
    return `<div class="empty-state"><strong>Пока нет разблокированных фраз</strong><p>Начни урок — его полные реплики появятся здесь вместе с новыми словами.</p></div>`;
  }
  const groups = groupPhraseRows(rows);
  return `
    <div class="unlocked-words-groups">
      ${groups.map((group) => `
        <section class="section-band with-top-gap">
          <div class="section-heading"><div><p class="eyebrow">${group.rows.length} фраз</p><h4>${escapeHtml(group.label)}</h4></div></div>
          <div class="table-wrap">
            <table class="vocab-table">
              <thead><tr><th>Французский</th><th>Перевод</th><th>Повторение</th></tr></thead>
              <tbody>
                ${group.rows.map((row) => `
                  <tr>
                    <td><strong>${escapeHtml(row.french)}</strong><button class="inline-audio" type="button" data-phrase-speak="${escapeHtml(row.audioText)}" aria-label="Прослушать ${escapeHtml(row.french)}">▶</button></td>
                    <td>${escapeHtml(row.russian)}</td>
                    <td>${nl2br(row.reviewLabel)}</td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>
        </section>`).join("")}
    </div>`;
}

function renderProgress() {
  const completed = state.appState.completedLessons.length;
  const legacyCompleted = state.appState.legacyCompletedLessons.length;
  const cards = getAllCards();
  const activeCards = getActiveCards();
  const cardIds = new Set(cards.map((card) => card.id));
  const reviewed = new Set(state.reviewLogs.filter((log) => cardIds.has(log.cardId)).map((log) => log.cardId)).size;
  const due = activeCards.filter((card) => isDueSchedule(state.schedules.get(card.id))).length;
  const pronunciationCards = buildPronunciationCards(state.pronunciationData);
  const activePronunciationCards = getActivePronunciationCards(pronunciationCards);
  const pronunciationCardIds = new Set(pronunciationCards.map((card) => card.id));
  const reviewedPronunciation = new Set(
    state.reviewLogs.filter((log) => pronunciationCardIds.has(log.cardId)).map((log) => log.cardId)
  ).size;
  const duePronunciation = activePronunciationCards.filter((card) => isDueSchedule(state.schedules.get(card.id))).length;
  const checkpoint = state.data.lessons.find((lesson) => lesson.id === "l38");
  const checkpointReadiness = checkpoint
    ? evaluateLessonReadiness(checkpoint, state.exerciseAttempts, state.recordings)
    : null;
  const exitStates = new Map((checkpointReadiness?.objectives?.evidence || []).map((item) => [item.objectiveId, item.state]));
  const exitAxes = (checkpoint?.objectives || []).map((objective) => ({
    skill: objective.skill,
    state: exitStates.get(objective.id) || "incomplete"
  }));
  const exitReady = Boolean(checkpointReadiness?.canComplete && exitAxes.length === 7 && exitAxes.every((item) => item.state === "mastered"));
  app.innerHTML = `
    <div class="metrics-grid">
      ${renderMetric("Пройдено уроков", `${completed}/${state.data.lessons.length}`, "Разговорные сценарии")}
      ${renderMetric("Старый прогресс", legacyCompleted, "Сохранён; уроки нужно подтвердить по новой модели")}
      ${renderMetric("Карточки", cards.length, `${reviewed} уже изучались`)}
      ${renderMetric("Нужно повторить", due, "По расписанию FSRS")}
      ${renderMetric("Свои слова", state.customNotes.length, "Хранятся только на этом устройстве")}
      ${renderMetric("Правила чтения", `${state.pronunciationState.completedLessons.length}/${state.pronunciationData.lessons.length}`, "Независимые уроки")}
      ${renderMetric("Звуки FSRS", duePronunciation, `${reviewedPronunciation} карточек уже изучались`)}
    </div>
    <section class="section-band with-top-gap">
      <div class="section-heading"><div><p class="eyebrow">Практический A1</p><h4>A1 exit evidence: ${exitReady ? "готово" : "ещё не готово"}</h4></div></div>
      <p class="note">Checkpoint l38 подтверждает все семь навыков; карточки к повторению (${due}) рекомендуются, но не блокируют путь.</p>
      <div class="skill-evidence-grid">${exitAxes.map((item) => `<div class="skill-evidence ${escapeHtml(item.state)}"><strong>${escapeHtml(item.skill)}</strong><span>${item.state === "mastered" ? "подтверждено" : "нужно checkpoint-задание"}</span></div>`).join("")}</div>
    </section>
    <section class="section-band with-top-gap">
      <div class="section-heading"><div><p class="eyebrow">История</p><h4>Последние повторения</h4></div></div>
      ${state.reviewLogs.length ? `
        <div class="history-list">${[...state.reviewLogs].sort((a, b) => new Date(b.reviewedAt) - new Date(a.reviewedAt)).slice(0, 12).map((log) => {
          const card = cards.find((item) => item.id === log.cardId)
            || pronunciationCards.find((item) => item.id === log.cardId);
          return `<div class="history-row"><strong>${escapeHtml(card?.front || card?.prompt || "Удалённая карточка")}</strong><span>${escapeHtml(log.rating)}</span><time>${formatDateTime(log.reviewedAt)}</time></div>`;
        }).join("")}</div>` : `<div class="empty-state">История появится после первого повторения.</div>`}
    </section>`;
}

function renderSettings() {
  const voiceOptions = VOICE_OPTIONS.map((voice) => `
    <option value="${escapeHtml(voice.id)}" ${voice.id === state.settings.voiceURI ? "selected" : ""}>
      ${escapeHtml(voice.label)}
    </option>`).join("");
  app.innerHTML = `
    <div class="settings-layout">
      <section class="section-band">
        <div class="section-heading"><div><p class="eyebrow">Произношение</p><h4>Французский голос</h4></div></div>
        <label class="field-label">Голос
          <select class="select-control full-control" id="voice-select">
            ${voiceOptions}
          </select>
        </label>
        <label class="field-label">Скорость: <output id="voice-rate-output">${state.settings.voiceRate.toFixed(2)}</output>
          <input id="voice-rate" type="range" min="0.55" max="1.1" step="0.05" value="${state.settings.voiceRate}" />
        </label>
        <button class="secondary-button" type="button" id="test-voice">Прослушать пример</button>
        <p class="note">Голос синтезируется локальным TTS-сервером (бесплатные neural-голоса). После первого прослушивания фраза или своё слово играются из кэша без обращения к сети.</p>
      </section>

      <section class="section-band">
        <div class="section-heading"><div><p class="eyebrow">Повторение FSRS</p><h4>Темп новых слов</h4></div></div>
        <label class="field-label">Новых слов в день
          <input id="new-cards-per-day" type="number" min="0" max="1000" step="1" inputmode="numeric" value="${state.settings.newCardsPerDay}" />
        </label>
        <p class="note">Это лимит только на новые слова. Карточки, которым FSRS назначил повтор через 1 или 10 минут, появляются вне лимита и в первую очередь. Изменение применяется сразу.</p>
      </section>

      <section class="section-band">
        <div class="section-heading"><div><p class="eyebrow">Повторение чтения FSRS</p><h4>Отдельный темп правил чтения</h4></div></div>
        <label class="field-label">Новых карточек чтения в день
          <input id="pronunciation-new-cards-per-day" type="number" min="0" max="1000" step="1" inputmode="numeric" value="${state.settings.pronunciationNewCardsPerDay}" />
        </label>
        <p class="note">Этот лимит действует только во вкладке «Повторение чтения» и не расходует дневной лимит слов и фраз.</p>
      </section>

      <section class="section-band">
        <div class="section-heading"><div><p class="eyebrow">Данные на компьютере</p><h4>Единый файл прогресса</h4></div></div>
        <p>Все уроки, ответы, свои слова, карточки FSRS и голосовые записи сохраняются в:</p>
        <p class="storage-path"><code>${escapeHtml(state.storage.path)}</code></p>
        <p class="note">Этот файл общий для всех браузеров, адресов и портов на этом компьютере. IndexedDB используется только как локальный кэш.</p>
        <div class="stacked-actions">
          <button class="secondary-button" type="button" id="backup-light">Лёгкая копия без аудио</button>
          <button class="secondary-button" type="button" id="backup-full">Полная копия с аудио</button>
          <label class="secondary-button file-button">Восстановить из JSON<input id="restore-backup" type="file" accept="application/json,.json" /></label>
        </div>
        <p class="note">Перед каждым изменением сервер атомарно обновляет основной файл и сохраняет предыдущую версию рядом как <code>french-study-data.backup.json</code>.</p>
      </section>

      <section class="section-band">
        <div class="section-heading"><div><p class="eyebrow">Необязательно</p><h4>Anki</h4></div></div>
        <p>Anki — отдельная программа с карточками. Встроенный FSRS уже выполняет ту же основную задачу, поэтому экспорт нужен только для переноса карточек.</p>
        <button class="secondary-button" type="button" id="export-anki">Экспортировать Anki TSV</button>
      </section>

      <section class="section-band danger-band">
        <div class="section-heading"><div><p class="eyebrow">Опасная зона</p><h4>Сброс кабинета</h4></div></div>
        <button class="danger-button" type="button" id="reset-progress">Удалить весь общий прогресс</button>
      </section>
    </div>`;
  bindSettingsActions();
}

function renderLessonInto(container, lesson) {
  const template = document.querySelector("#lesson-template").content.cloneNode(true);
  template.querySelector(".lesson-level").textContent = `${lesson.level} · ${lesson.scenario}`;
  template.querySelector(".lesson-title").textContent = lesson.title;
  template.querySelector(".lesson-goal").textContent = lesson.goal;
  const objectives = template.querySelector(".lesson-objectives");
  objectives.innerHTML = (lesson.objectives || []).map((objective) => {
    if (typeof objective === "string") return `<li>${escapeHtml(objective)}</li>`;
    const canDo = objective?.canDo || objective?.cefrCanDo || objective?.text || objective?.id || "Учебная цель";
    return `<li>${objective?.skill ? `<span class="tag">${escapeHtml(objective.skill)}</span> ` : ""}${escapeHtml(canDo)}</li>`;
  }).join("");
  objectives.hidden = !lesson.objectives?.length;
  template.querySelector(".complete-lesson").addEventListener("click", () => markLessonComplete(lesson.id));
  template.querySelector(".dialogue-list").innerHTML = lesson.dialogue.map(renderDialogueLine).join("");
  template.querySelector(".lesson-vocabulary").innerHTML = renderLessonVocabulary(lesson.vocabulary);
  template.querySelector(".pronunciation-target").innerHTML = renderPronunciationForLesson(lesson);
  template.querySelector(".grammar-note").innerHTML = renderGrammarForLesson(lesson);
  template.querySelector(".exercise-list").innerHTML = lesson.exercises
    .map((exercise, index) => renderExercise(lesson, exercise, index))
    .join("");
  template.querySelector(".voice-lab").innerHTML = renderVoiceLab(lesson.targetPhrase, `lesson:${lesson.id}`);
  container.replaceChildren(template);
  updateLessonCompletionUI(container, lesson);
  bindLessonActions(container, lesson);
  bindVoiceLabs(container);
}

function bindLessonActions(container, lesson) {
  container.querySelectorAll("[data-speak]").forEach((button) => {
    if (button.closest(".voice-lab-box")) return;
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

function renderExercise(lesson, exercise, index) {
  const id = exercise.id || `${lesson.id}-${index}`;
  const attempt = state.exerciseAttempts.get(id) || { id, lessonId: lesson.id, answer: "" };
  const result = attempt.result;
  const modelVisible = attempt.showModel;
  const hintVisible = attempt.showHint;
  const canSelfReview = isSelfReviewExercise(exercise)
    && modelVisible
    && result?.needsReview === true
    && result?.coverageComplete === true
    && (!isRecordingRequired(exercise) || hasExerciseRecording(attempt, exercise));
  return `
    <div class="exercise" data-exercise-id="${escapeHtml(id)}">
      <div class="exercise-header"><span class="tag">${escapeHtml(exercise.type)}</span>${result ? `<span class="result-badge ${escapeHtml(result.status)}">${resultLabel(result.status)}</span>` : ""}</div>
      <p><strong>${escapeHtml(exercise.prompt)}</strong></p>
      ${renderExerciseSupport(exercise, modelVisible)}
      <textarea placeholder="${escapeHtml(exercisePlaceholder(exercise))}">${escapeHtml(attempt.answer || "")}</textarea>
      <div class="control-row">
        <button class="primary-button compact-button" type="button" data-check-exercise>Проверить</button>
        <button class="pill-button" type="button" data-show-hint>Подсказка</button>
        <button class="pill-button" type="button" data-show-model>Показать пример</button>
      </div>
      ${result ? `<div class="exercise-feedback ${escapeHtml(result.status)}">${escapeHtml(result.message)}${result.missing?.length ? `<br><strong>Добавь:</strong> ${result.missing.map(escapeHtml).join(", ")}` : ""}</div>` : ""}
      ${hintVisible ? `<div class="exercise-help"><strong>Подсказка:</strong> ${escapeHtml(exercise.hints?.join(" ") || "Вернись к диалогу и найди нужную конструкцию.")}</div>` : ""}
      ${modelVisible ? `<div class="model-answer"><strong>Возможный ответ</strong><p>${nl2br(exercise.modelAnswer || exercise.acceptedAnswers?.[0] || "Ответ зависит от твоей ситуации.")}</p>${exercise.explanation ? `<span>${escapeHtml(exercise.explanation)}</span>` : ""}</div>` : ""}
      ${isRecordingRequired(exercise) ? `<div class="exercise-recording">${renderVoiceLab(exercise.modelAnswer, `exercise:${lesson.id}:${id}`, { lessonId: lesson.id, exerciseId: id, minimumSeconds: exercise.minimumRecordingSeconds || 5 })}</div>` : ""}
      ${canSelfReview ? `<button class="secondary-button self-review-button" type="button" data-self-review ${attempt.selfReviewed ? "disabled" : ""}>${attempt.selfReviewed ? "Сравнение подтверждено" : "Я сравнил и исправил"}</button>` : ""}
    </div>`;
}

function renderExerciseSupport(exercise, modelVisible) {
  const parts = [];
  if (exercise.sourceText) {
    parts.push(`<div class="exercise-source"><strong>Материал</strong><p>${nl2br(exercise.sourceText)}</p></div>`);
  }
  if (exercise.listenText || (["listening-comprehension", "dictation"].includes(exercise.type) && exercise.transcript)) {
    const listenText = exercise.listenText || exercise.transcript;
    parts.push(`<button class="pill-button exercise-listen" type="button" data-speak="${escapeHtml(listenText)}">Прослушать</button>`);
  }
  if (Array.isArray(exercise.options) && exercise.options.length) {
    parts.push(`<ul class="exercise-options">${exercise.options.map((option) => `<li>${escapeHtml(option)}</li>`).join("")}</ul>`);
  }
  if (Array.isArray(exercise.rubric) && exercise.rubric.length) {
    parts.push(`<div class="exercise-rubric"><strong>Критерии</strong><ul>${exercise.rubric.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`);
  }
  if (modelVisible && exercise.transcript) {
    parts.push(`<div class="exercise-transcript"><strong>Транскрипт</strong><p>${nl2br(exercise.transcript)}</p></div>`);
  }
  return parts.join("");
}

function exercisePlaceholder(exercise) {
  if (exercise.type === "dictation") return "Запиши услышанную фразу...";
  if (["speaking", "roleplay", "conversation-prompt", "debate-roleplay", "recorded-monologue"].includes(exercise.type)) {
    return "Напиши план ответа или произнесённую фразу...";
  }
  if (["rubric-writing", "guided-writing", "message-reply"].includes(exercise.type)) {
    return "Напиши связный ответ по критериям...";
  }
  if (["mediation", "summarize-for-a-friend"].includes(exercise.type)) return "Передай смысл своими словами...";
  return "Напиши свой ответ здесь...";
}

function isSelfReviewExercise(exercise) {
  return [
    "writing",
    "speaking",
    "substitution",
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
  ].includes(exercise.type);
}

function isRecordingRequired(exercise) {
  if (exercise?.requiresRecording === false) return false;
  return ["speaking", "roleplay", "conversation-prompt", "recorded-monologue"].includes(exercise?.type);
}

function hasExerciseRecording(attempt, exercise) {
  const record = state.recordings.get(attempt?.recordingKey);
  return Boolean(record && Number(record.durationMs) >= Number(exercise.minimumRecordingSeconds || 5) * 1000);
}

function bindExercise(box, lesson) {
  const id = box.dataset.exerciseId;
  const exercise = lesson.exercises.find((item, index) => (item.id || `${lesson.id}-${index}`) === id);
  const textarea = box.querySelector("textarea");
  textarea.addEventListener("input", () => {
    const attempt = getExerciseAttempt(id, lesson.id);
    if (attempt.answer !== textarea.value) {
      delete attempt.result;
      delete attempt.checkedAt;
      attempt.selfReviewed = false;
    }
    attempt.answer = textarea.value;
    attempt.updatedAt = new Date().toISOString();
    state.exerciseAttempts.set(id, attempt);
    void runSave(() => putRecord("exercises", { ...attempt }));
    updateLessonCompletionUI(box.closest(".lesson-layout"), lesson);
  });
  box.querySelector("[data-check-exercise]").addEventListener("click", async () => {
    const attempt = getExerciseAttempt(id, lesson.id);
    attempt.answer = textarea.value;
    attempt.result = checkExercise(exercise, textarea.value);
    attempt.selfReviewed = false;
    attempt.checkedAt = new Date().toISOString();
    state.exerciseAttempts.set(id, attempt);
    await putRecord("exercises", attempt);
    preserveScrollAndRender();
  });
  box.querySelector("[data-show-hint]").addEventListener("click", async () => {
    const attempt = getExerciseAttempt(id, lesson.id);
    attempt.showHint = true;
    state.exerciseAttempts.set(id, attempt);
    await putRecord("exercises", attempt);
    preserveScrollAndRender();
  });
  box.querySelector("[data-show-model]").addEventListener("click", async () => {
    const attempt = getExerciseAttempt(id, lesson.id);
    attempt.showModel = true;
    state.exerciseAttempts.set(id, attempt);
    await putRecord("exercises", attempt);
    preserveScrollAndRender();
  });
  box.querySelector("[data-self-review]")?.addEventListener("click", async () => {
    const attempt = getExerciseAttempt(id, lesson.id);
    if (!attempt.showModel || attempt.result?.needsReview !== true || attempt.result?.coverageComplete !== true || (isRecordingRequired(exercise) && !hasExerciseRecording(attempt, exercise))) return;
    attempt.selfReviewed = true;
    attempt.updatedAt = new Date().toISOString();
    state.exerciseAttempts.set(id, attempt);
    await putRecord("exercises", attempt);
    preserveScrollAndRender();
  });
}

function renderLessonVocabulary(vocabulary = []) {
  return `<div class="lesson-vocabulary-grid">${vocabulary.map((item) => `
    <article class="lesson-vocabulary-item">
      <div><strong>${escapeHtml(item.fr)}</strong><button class="inline-audio" type="button" data-speak="${escapeHtml(item.fr)}" aria-label="Прослушать ${escapeHtml(item.fr)}">▶</button><span class="ipa">${escapeHtml(item.ipa)}</span></div>
      <div class="translation">${escapeHtml(item.ru)}</div>
      <p class="note">${escapeHtml(item.note)}</p>
    </article>`).join("")}</div>`;
}

function renderReviewCard(card) {
  const schedule = state.schedules.get(card.id) || createSchedule(card.id);
  const preview = state.reviewMode === "cram"
    ? Object.fromEntries(["again", "hard", "good", "easy"].map((rating) => [rating, { interval: "без изменения графика" }]))
    : previewSchedule(schedule);
  const front = card.kind === "cloze" ? renderClozeFront(card.front) : card.front;
  return `
    <article class="review-card" data-card-id="${escapeHtml(card.id)}">
      <div class="review-context">${escapeHtml(card.lessonTitle)} · ${escapeHtml(card.kind)}</div>
      <div class="review-front">${nl2br(front)}</div>
      <div class="control-row review-primary-actions">
        <button class="icon-text-button" type="button" data-card-speak aria-label="Прослушать">▶ Прослушать</button>
        ${state.reviewAnswerVisible ? "" : `<button class="primary-button" type="button" id="show-answer">Показать ответ</button>`}
      </div>
      ${state.reviewAnswerVisible ? `
        <div class="review-back visible">
          ${card.kind === "cloze" ? `<p class="cloze-reveal">${nl2br(revealCloze(card.front))}</p>` : ""}
          <p class="fr">${nl2br(card.back)}</p>
          <div class="rating-grid">
            ${renderRatingButton("again", "Again", preview.again.interval)}
            ${renderRatingButton("hard", "Hard", preview.hard.interval)}
            ${renderRatingButton("good", "Good", preview.good.interval)}
            ${renderRatingButton("easy", "Easy", preview.easy.interval)}
          </div>
        </div>` : ""}
      <div class="review-card-tools">
        <button type="button" data-card-skip>В конец очереди</button>
        <button type="button" data-card-reset>Сбросить карточку</button>
        ${card.source === "custom" ? `<button type="button" data-card-edit>Редактировать</button>` : ""}
        <button type="button" data-card-suspend>Приостановить</button>
      </div>
    </article>`;
}

function bindReviewToolbar() {
  document.querySelectorAll("[data-review-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.reviewMode = button.dataset.reviewMode;
      state.reviewSeen.clear();
      state.reviewAnswerVisible = false;
      renderReview();
    });
  });
  document.querySelectorAll("[data-review-direction]").forEach((button) => {
    button.addEventListener("click", () => {
      state.reviewDirection = button.dataset.reviewDirection;
      state.reviewSeen.clear();
      state.reviewAnswerVisible = false;
      renderReview();
    });
  });
  document.querySelector("#review-deck")?.addEventListener("change", (event) => {
    state.reviewDeck = event.target.value;
    state.reviewSeen.clear();
    state.reviewAnswerVisible = false;
    renderReview();
  });
  document.querySelector("#review-add-word").addEventListener("click", () => openWordDialog());
  document.querySelectorAll("[data-card-resume]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.appState.suspendedCardIds = state.appState.suspendedCardIds.filter(
        (id) => id !== button.dataset.cardResume
      );
      await saveAppState();
      renderReview();
    });
  });
}

function bindReviewCard(card) {
  document.querySelector("#show-answer")?.addEventListener("click", () => {
    state.reviewAnswerVisible = true;
    renderReview();
  });
  document.querySelector("[data-card-speak]").addEventListener("click", () => speakFrench(card.audioText));
  document.querySelectorAll("[data-score]").forEach((button) => {
    button.addEventListener("click", () => gradeReviewCard(card, button.dataset.score));
  });
  document.querySelector("[data-card-skip]").addEventListener("click", () => {
    state.reviewSeen.add(card.id);
    state.reviewAnswerVisible = false;
    renderReview();
  });
  document.querySelector("[data-card-reset]").addEventListener("click", async () => {
    const schedule = resetSchedule(card.id);
    state.schedules.set(card.id, schedule);
    await putRecord("schedules", schedule);
    state.reviewSeen.add(card.id);
    state.reviewAnswerVisible = false;
    renderReview();
  });
  document.querySelector("[data-card-suspend]").addEventListener("click", async () => {
    if (!state.appState.suspendedCardIds.includes(card.id)) state.appState.suspendedCardIds.push(card.id);
    await saveAppState();
    state.reviewAnswerVisible = false;
    renderReview();
  });
  document.querySelector("[data-card-edit]")?.addEventListener("click", () => {
    openWordDialog(state.customNotes.find((note) => note.id === card.noteId));
  });
}

async function gradeReviewCard(card, rating) {
  if (state.reviewSaving) return;
  if (state.reviewMode === "cram") {
    state.reviewSeen.add(card.id);
    state.reviewAnswerVisible = false;
    renderReview();
    return;
  }
  state.reviewSaving = true;
  showSaving();
  const schedule = state.schedules.get(card.id) || createSchedule(card.id);
  const { schedule: nextSchedule, log } = reviewSchedule(schedule, rating);
  log.id = `${card.id}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  try {
    await putReviewResult(nextSchedule, log);
    state.schedules.set(card.id, nextSchedule);
    state.reviewLogs.push(log);
    state.reviewAnswerVisible = false;
    showSaved();
    renderReview();
  } catch (error) {
    showSaveError(error);
  } finally {
    state.reviewSaving = false;
  }
}

function openWordDialog(note = null) {
  const editing = Boolean(note);
  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="word-dialog-title">
        <div class="section-heading"><div><p class="eyebrow">Своя карточка</p><h4 id="word-dialog-title">${editing ? "Редактировать слово" : "Добавить слово"}</h4></div><button class="modal-close" type="button" aria-label="Закрыть">×</button></div>
        <form id="word-form">
          <label class="field-label">Французский<input name="fr" required value="${escapeHtml(note?.fr || "")}" /></label>
          <label class="field-label">Перевод<input name="ru" required value="${escapeHtml(note?.ru || "")}" /></label>
          <label class="field-label">IPA<input name="ipa" value="${escapeHtml(note?.ipa || "")}" placeholder="/bɔ̃.ʒuʁ/" /></label>
          <label class="field-label">Заметка<textarea name="note">${escapeHtml(note?.note || "")}</textarea></label>
          <label class="field-label">Теги<input name="tags" value="${escapeHtml((note?.tags || []).join(", "))}" placeholder="еда, A1" /></label>
          <label class="field-label">Направление<select name="direction" class="select-control full-control">
            <option value="both" ${!note || note.directions?.length === 2 ? "selected" : ""}>Обе стороны</option>
            <option value="ru-fr" ${note?.directions?.length === 1 && note.directions[0] === "ru-fr" ? "selected" : ""}>Русский → французский</option>
            <option value="fr-ru" ${note?.directions?.length === 1 && note.directions[0] === "fr-ru" ? "selected" : ""}>Французский → русский</option>
          </select></label>
          <div class="control-row modal-actions"><button class="primary-button" type="submit">Сохранить</button><button class="secondary-button" type="button" data-cancel>Отмена</button></div>
        </form>
      </section>
    </div>`;
  const close = () => { modalRoot.innerHTML = ""; };
  modalRoot.querySelector(".modal-close").addEventListener("click", close);
  modalRoot.querySelector("[data-cancel]").addEventListener("click", close);
  modalRoot.querySelector("#word-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = new FormData(event.target);
    const direction = values.get("direction");
    const record = {
      id: note?.id || `custom:${crypto.randomUUID()}`,
      source: "custom",
      fr: values.get("fr").trim(),
      ru: values.get("ru").trim(),
      ipa: values.get("ipa").trim(),
      note: values.get("note").trim(),
      tags: values.get("tags").split(",").map((tag) => tag.trim()).filter(Boolean),
      directions: direction === "both" ? ["ru-fr", "fr-ru"] : [direction],
      createdAt: note?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await putRecord("vocabulary", record);
    const index = state.customNotes.findIndex((item) => item.id === record.id);
    if (index >= 0) state.customNotes[index] = record;
    else state.customNotes.push(record);
    close();
    showSaved();
    render();
  });
}

function bindVocabularyActions() {
  document.querySelectorAll("[data-vocab-speak]").forEach((button) => {
    button.addEventListener("click", () => speakFrench(button.dataset.vocabSpeak));
  });
  document.querySelectorAll("[data-note-suspend]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.noteSuspend;
      const current = state.appState.suspendedNoteIds;
      state.appState.suspendedNoteIds = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      await saveAppState();
      renderVocabulary();
    });
  });
  document.querySelectorAll("[data-note-edit]").forEach((button) => {
    button.addEventListener("click", () => openWordDialog(state.customNotes.find((note) => note.id === button.dataset.noteEdit)));
  });
  document.querySelectorAll("[data-note-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const note = state.customNotes.find((item) => item.id === button.dataset.noteDelete);
      if (!note || !window.confirm(`Удалить «${note.fr}» и его карточки?`)) return;
      for (const card of cardsFromVocabularyNote(note)) {
        await deleteRecord("schedules", card.id);
        state.schedules.delete(card.id);
      }
      await deleteRecord("vocabulary", note.id);
      state.customNotes = state.customNotes.filter((item) => item.id !== note.id);
      renderVocabulary();
    });
  });
}

function bindSettingsActions() {
  const voiceSelect = document.querySelector("#voice-select");
  const rate = document.querySelector("#voice-rate");
  const newCardsPerDay = document.querySelector("#new-cards-per-day");
  const pronunciationNewCardsPerDay = document.querySelector("#pronunciation-new-cards-per-day");
  voiceSelect.addEventListener("change", async () => {
    state.settings.voiceURI = voiceSelect.value;
    await saveSettings();
  });
  rate.addEventListener("input", () => {
    state.settings.voiceRate = Number(rate.value);
    document.querySelector("#voice-rate-output").textContent = Number(rate.value).toFixed(2);
    debounceSave("settings", () => setValue("settings", state.settings));
  });
  rate.addEventListener("change", () => {
    void flushPendingSave("settings");
  });
  newCardsPerDay.addEventListener("change", async () => {
    const limit = Number(newCardsPerDay.value);
    if (!Number.isInteger(limit) || limit < 0 || limit > 1000) {
      newCardsPerDay.value = state.settings.newCardsPerDay;
      window.alert("Укажи целое число от 0 до 1000.");
      return;
    }
    state.settings.newCardsPerDay = limit;
    await saveSettings();
  });
  pronunciationNewCardsPerDay.addEventListener("change", async () => {
    const limit = Number(pronunciationNewCardsPerDay.value);
    if (!Number.isInteger(limit) || limit < 0 || limit > 1000) {
      pronunciationNewCardsPerDay.value = state.settings.pronunciationNewCardsPerDay;
      window.alert("Укажи целое число от 0 до 1000.");
      return;
    }
    state.settings.pronunciationNewCardsPerDay = limit;
    await saveSettings();
  });
  document.querySelector("#test-voice").addEventListener("click", () => speakFrench("Bonjour, je voudrais un café, s'il vous plaît."));
  document.querySelector("#backup-light").addEventListener("click", () => downloadBackup(false));
  document.querySelector("#backup-full").addEventListener("click", () => downloadBackup(true));
  document.querySelector("#restore-backup").addEventListener("change", restoreBackup);
  document.querySelector("#export-anki").addEventListener("click", exportAnki);
  document.querySelector("#reset-progress").addEventListener("click", async () => {
    if (!window.confirm("Очистить общий файл прогресса: уроки, карточки, свои слова, ответы и аудиозаписи? Предыдущая версия останется в backup-файле.")) return;
    await clearDatabase();
    localStorage.removeItem("frenchStudyProgress");
    window.location.reload();
  });
}

function bindVoiceLabs(scope = document) {
  scope.querySelectorAll(".voice-lab-box").forEach((box) => {
    const target = box.dataset.target;
    const key = box.dataset.key;
    const startButton = box.querySelector("[data-record-start]");
    const stopButton = box.querySelector("[data-record-stop]");
    const status = box.querySelector(".recording-status");
    const audio = box.querySelector("audio");
    box.querySelector("[data-speak]").addEventListener("click", () => speakFrench(target));
    const lessonId = box.dataset.lessonId || null;
    const exerciseId = box.dataset.exerciseId || null;
    const minimumSeconds = Number(box.dataset.minimumSeconds || 0);
    startButton.addEventListener("click", () => startRecording({ key, status, audio, startButton, stopButton, lessonId, exerciseId, minimumSeconds }));
    stopButton.addEventListener("click", () => stopRecording());
    const transcribeButton = box.querySelector("[data-transcribe]");
    transcribeButton.addEventListener("click", () => transcribeRecording(
      key,
      target,
      box.querySelector(".transcript-output"),
      transcribeButton
    ));
    restoreRecording(key, audio, status);
  });
}

async function startRecording(context) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    context.status.textContent = "Запись недоступна в этом браузере.";
    return;
  }
  if (state.recordingPending || state.recordingContext?.recorder?.state === "recording") {
    context.status.textContent = "Сначала останови текущую запись.";
    return;
  }
  const requestId = ++state.recordingRequestId;
  state.recordingPending = true;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (requestId !== state.recordingRequestId) {
      stopMediaStream(stream);
      return;
    }
    const recorder = new MediaRecorder(stream);
    const recording = { ...context, stream, recorder, chunks: [], startedAt: Date.now() };
    state.audioChunks = recording.chunks;
    state.recordingContext = recording;
    state.mediaRecorder = recorder;
    state.recordingPending = false;
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) recording.chunks.push(event.data);
    });
    recorder.addEventListener("stop", () => saveFinishedRecording(recording));
    recorder.start();
    setRecordingButtonsDisabled(true, context.startButton);
    context.status.textContent = "Идёт запись...";
    context.startButton.disabled = true;
    context.stopButton.disabled = false;
  } catch (error) {
    stopMediaStream(stream);
    if (requestId === state.recordingRequestId) {
      state.recordingPending = false;
      clearRecordingContext();
    }
    context.status.textContent = `Нет доступа к микрофону: ${error.message}`;
  }
}

function stopRecording() {
  state.recordingRequestId += 1;
  state.recordingPending = false;
  const recording = state.recordingContext;
  if (!recording) return;
  if (recording.recorder?.state === "recording") recording.recorder.stop();
  stopMediaStream(recording.stream);
  if (recording.startButton?.isConnected) recording.startButton.disabled = true;
  if (recording.stopButton?.isConnected) recording.stopButton.disabled = true;
  if (recording.status?.isConnected) recording.status.textContent = "Останавливаем и сохраняем запись...";
}

async function saveFinishedRecording(recording) {
  stopMediaStream(recording.stream);
  const blob = new Blob(recording.chunks, { type: recording.recorder.mimeType || "audio/webm" });
  try {
    showSaving();
    const durationMs = Math.max(0, Date.now() - recording.startedAt);
    const record = {
      id: recording.key,
      blob,
      updatedAt: new Date().toISOString(),
      size: blob.size,
      durationMs,
      ...(recording.lessonId ? { lessonId: recording.lessonId } : {}),
      ...(recording.exerciseId ? { exerciseId: recording.exerciseId } : {})
    };
    let exerciseAttempt = null;
    if (recording.exerciseId && recording.lessonId) {
      exerciseAttempt = {
        ...getExerciseAttempt(recording.exerciseId, recording.lessonId),
        recordingKey: record.id,
        updatedAt: record.updatedAt
      };
    }
    await putRecordingResult(record, exerciseAttempt);
    state.recordings.set(record.id, record);
    if (exerciseAttempt) state.exerciseAttempts.set(exerciseAttempt.id, exerciseAttempt);
    if (recording.audio?.isConnected) setAudioSource(recording.audio, blob);
    if (recording.status?.isConnected) {
      recording.status.textContent = recording.minimumSeconds && durationMs < recording.minimumSeconds * 1000
        ? `Запись сохранена, но она короче ${recording.minimumSeconds} сек. Запиши ещё раз, чтобы подтвердить упражнение.`
        : "Запись сохранена локально. Можно перезагрузить страницу и продолжить.";
    }
    showSaved();
  } catch (error) {
    if (recording.status?.isConnected) recording.status.textContent = `Не удалось сохранить запись: ${error.message}`;
    showSaveError(error);
  } finally {
    if (recording.startButton?.isConnected) recording.startButton.disabled = false;
    if (recording.stopButton?.isConnected) recording.stopButton.disabled = true;
    if (state.recordingContext === recording) clearRecordingContext();
    const currentRecording = state.recordingContext;
    setRecordingButtonsDisabled(
      currentRecording?.recorder?.state === "recording",
      currentRecording?.startButton || null
    );
  }
}

function stopMediaStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

function clearRecordingContext() {
  state.mediaRecorder = null;
  state.recordingContext = null;
  state.audioChunks = [];
}

function setRecordingButtonsDisabled(disabled, activeButton = null) {
  document.querySelectorAll("[data-record-start]").forEach((button) => {
    button.disabled = disabled && button !== activeButton;
  });
}

async function restoreRecording(key, audio, status) {
  const record = await getRecord("recordings", key);
  if (!record?.blob || !audio.isConnected) return;
  setAudioSource(audio, record.blob);
  status.textContent = `Последняя запись: ${formatDateTime(record.updatedAt)}`;
}

function setAudioSource(audio, blob) {
  const url = URL.createObjectURL(blob);
  state.audioUrls.add(url);
  audio.src = url;
  audio.hidden = false;
}

async function transcribeRecording(key, target, output, button) {
  const recording = await getRecord("recordings", key);
  if (!recording?.blob) {
    output.textContent = "Сначала запиши и сохрани свою фразу, затем распознай эту запись.";
    return;
  }

  const previousLabel = button.textContent;
  button.disabled = true;
  output.textContent = "Распознаём запись локально…";
  try {
    const response = await fetch("/stt", {
      method: "POST",
      headers: { "Content-Type": recording.blob.type || "audio/webm" },
      body: recording.blob
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Локальный STT вернул HTTP ${response.status}.`);
    if (!result.transcript?.trim()) throw new Error("В записи не удалось распознать речь.");
    output.innerHTML = `<strong>Распознано:</strong> ${escapeHtml(result.transcript)}<br><span class="note">Цель: ${escapeHtml(target)}</span>`;
  } catch (error) {
    const message = error instanceof TypeError
      ? "Локальный STT-сервер недоступен. Перезапусти приложение командой python3 server.py."
      : error.message;
    output.textContent = `Распознавание не сработало: ${message}`;
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = previousLabel;
    }
  }
}

function speakFrench(text) {
  return synthesizeFrench(text, { voice: state.settings.voiceURI, rate: state.settings.voiceRate });
}

async function downloadBackup(includeRecordings) {
  const snapshot = await exportDatabase({ includeRecordings });
  const blob = createBackupBlob(snapshot);
  if (blob.size > MAX_BACKUP_FILE_BYTES) {
    window.alert(includeRecordings
      ? "Полная копия превышает 250 МБ и не сможет быть восстановлена. Создай лёгкую копию без аудио."
      : "Резервная копия превышает 250 МБ и не может быть безопасно восстановлена.");
    return false;
  }
  downloadBlob(blob, `french-study-${includeRecordings ? "full" : "light"}-${new Date().toISOString().slice(0, 10)}.json`);
  return true;
}

async function restoreBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > MAX_BACKUP_FILE_BYTES) {
      throw new Error("Файл резервной копии больше 250 МБ. Раздели архив или восстанови лёгкую копию без аудио.");
    }
    const snapshot = JSON.parse(await file.text());
    validateBackup(snapshot);
    if (!window.confirm("Заменить общий файл прогресса содержимым резервной копии?")) return;
    const safetySnapshot = await exportDatabase({ includeRecordings: true });
    const safetyBlob = createBackupBlob(safetySnapshot);
    if (safetyBlob.size > MAX_BACKUP_FILE_BYTES) {
      throw new Error("Текущая полная защитная копия превышает 250 МБ. Восстановление отменено; сначала сохрани или удали большие аудиозаписи.");
    }
    downloadBlob(safetyBlob, `french-study-before-restore-${new Date().toISOString().slice(0, 10)}.json`);
    await importDatabase(snapshot);
    window.location.reload();
  } catch (error) {
    window.alert(`Не удалось восстановить копию: ${error.message}`);
  } finally {
    event.target.value = "";
  }
}

function createBackupBlob(snapshot) {
  return new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
}

function exportAnki() {
  downloadBlob(
    new Blob([buildAnkiTsv(getAllCards())], { type: "text/tab-separated-values;charset=utf-8" }),
    "french-study-anki.tsv"
  );
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getVocabularyNotes() {
  return buildVocabularyNotes(state.data, state.customNotes);
}

function getAllCards() {
  return buildCards(state.data, state.customNotes);
}

function getActiveCards() {
  const introducedLessons = new Set(getIntroducedLessonIds({
    completedLessons: [...state.appState.completedLessons, ...state.appState.legacyCompletedLessons],
    attempts: state.exerciseAttempts,
    currentLessonId: state.currentLessonId
  }));
  return getAllCards().filter((card) => {
    const introduced = card.source === "custom" || introducedLessons.has(card.lessonId);
    return introduced
      && !state.appState.suspendedCardIds.includes(card.id)
      && !state.appState.suspendedNoteIds.includes(card.noteId);
  });
}

function getReviewSummary(cards = getActiveCards()) {
  const due = cards.filter((card) => isDueSchedule(state.schedules.get(card.id))).length;
  const newCount = cards.filter((card) => isNewSchedule(state.schedules.get(card.id))).length;
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const introducedToday = new Set(
    state.reviewLogs
      .filter((log) => log.wasNew && cardsById.has(log.cardId) && isToday(log.reviewedAt))
      .map((log) => cardsById.get(log.cardId).noteId)
  ).size;
  return {
    due,
    newCount,
    newSlots: Math.max(0, state.settings.newCardsPerDay - introducedToday)
  };
}

function getPronunciationReviewSummary(cards, logs) {
  const due = cards.filter((card) => isDueSchedule(state.schedules.get(card.id))).length;
  const newCount = cards.filter((card) => isNewSchedule(state.schedules.get(card.id))).length;
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const introducedToday = new Set(
    logs
      .filter((log) => log.wasNew && isToday(log.reviewedAt) && cardsById.has(log.cardId))
      .map((log) => cardsById.get(log.cardId).noteId)
  ).size;
  return {
    due,
    newCount,
    newSlots: Math.max(0, state.settings.pronunciationNewCardsPerDay - introducedToday)
  };
}

function renderVocabRow(note) {
  const suspended = state.appState.suspendedNoteIds.includes(note.id);
  return `
    <tr class="${suspended ? "suspended-row" : ""}">
      <td><strong>${escapeHtml(note.fr)}</strong><button class="inline-audio" type="button" data-vocab-speak="${escapeHtml(note.fr)}" aria-label="Прослушать ${escapeHtml(note.fr)}">▶</button><small>${escapeHtml(note.note || "")}</small></td>
      <td>${escapeHtml(note.ipa || "—")}</td>
      <td>${escapeHtml(note.ru)}</td>
      <td>${note.source === "custom" ? `<span class="tag rose">своё</span>` : escapeHtml(note.lessonTitle)}</td>
      <td><div class="row-actions">
        <button type="button" data-note-suspend="${escapeHtml(note.id)}">${suspended ? "Вернуть" : "Скрыть"}</button>
        ${note.source === "custom" ? `<button type="button" data-note-edit="${escapeHtml(note.id)}">Изменить</button><button type="button" data-note-delete="${escapeHtml(note.id)}">Удалить</button>` : ""}
      </div></td>
    </tr>`;
}

function renderDialogueLine(line) {
  return `<div class="dialogue-line"><div class="speaker">${escapeHtml(line.speaker)}</div><div><div class="fr">${escapeHtml(line.fr)}</div><div class="ipa">${escapeHtml(line.ipa)}</div><div class="translation">${escapeHtml(line.ru)}</div><button class="pill-button" type="button" data-speak="${escapeHtml(line.fr)}">Прослушать</button></div></div>`;
}

function renderPronunciationForLesson(lesson) {
  const topic = state.data.pronunciationTopics.find((item) => item.id === lesson.pronunciationTopic);
  return `<div class="target-phrase"><span class="tag rose">${escapeHtml(topic.level)}</span><strong>${escapeHtml(topic.title)}</strong><span>${escapeHtml(topic.target)}</span></div><p class="note">${escapeHtml(topic.cue)}</p><ul class="example-list">${topic.minimalPairs.map((pair) => `<li>${escapeHtml(pair)}</li>`).join("")}</ul><button class="pill-button" type="button" data-open-topic="pronunciation:${escapeHtml(topic.id)}">Подробнее →</button>`;
}

function renderGrammarForLesson(lesson) {
  const topic = state.data.grammarTopics.find((item) => item.id === lesson.grammarTopic);
  return `<div class="target-phrase"><span class="tag amber">${escapeHtml(topic.level)}</span><strong>${escapeHtml(topic.title)}</strong></div><p class="grammar-rule">${escapeHtml(topic.rule)}</p><ul class="example-list">${topic.examples.map((example) => `<li>${escapeHtml(example)}</li>`).join("")}</ul><button class="pill-button" type="button" data-open-topic="grammar:${escapeHtml(topic.id)}">Подробнее →</button>`;
}

function renderVoiceLab(target, key, options = {}) {
  const minimumSeconds = Number(options.minimumSeconds || 0);
  return `
    <div class="voice-lab-box" data-key="${escapeHtml(key)}" data-target="${escapeHtml(target)}"${options.lessonId ? ` data-lesson-id="${escapeHtml(options.lessonId)}"` : ""}${options.exerciseId ? ` data-exercise-id="${escapeHtml(options.exerciseId)}"` : ""}${minimumSeconds ? ` data-minimum-seconds="${minimumSeconds}"` : ""}>
      <div class="target-phrase"><span class="tag rose">voice</span><strong>${escapeHtml(target)}</strong><span class="note">Прослушай выбранный голос, затем запиши себя.${minimumSeconds ? ` Не менее ${minimumSeconds} сек.` : ""}</span></div>
      <div class="control-row"><button class="pill-button" type="button" data-speak>Эталон</button><button class="pill-button" type="button" data-record-start>Записать</button><button class="pill-button" type="button" data-record-stop disabled>Стоп</button><button class="pill-button" type="button" data-transcribe>Распознать запись</button><span class="recording-status">Готово к записи</span></div>
      <audio controls hidden></audio>
      <p class="note transcript-output">STT работает по сохранённой записи через локальный Whisper; подключение к сервису распознавания не нужно.</p>
    </div>`;
}

function bindSpeakButtons(scope = document) {
  scope.querySelectorAll("[data-speak]").forEach((button) => {
    if (button.closest(".voice-lab-box")) return;
    const text = button.dataset.speak;
    if (!text) return;
    button.addEventListener("click", () => speakFrench(text));
  });
}

function renderCourseRoadmap() {
  const roadmap = state.data.courseRoadmap;
  if (!roadmap?.levels?.length) return "";
  const sources = Array.isArray(roadmap.sources) ? roadmap.sources : [];
  return `
    <section class="section-band with-top-gap" aria-labelledby="roadmap-title">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Масштабирование A1-A2-B1-B2</p>
          <h4 id="roadmap-title">Roadmap курса: что должно появиться до заявления уровня</h4>
          <p class="note">${escapeHtml(roadmap.claimPolicy || "")}</p>
        </div>
      </div>
      <div class="roadmap-grid">
        ${roadmap.levels.map((level) => `
          <article class="roadmap-card">
            <div class="tag-row">
              <span class="tag">${escapeHtml(level.cefrLevel)}</span>
              <span class="tag ${level.status === "planned" ? "amber" : "rose"}">${escapeHtml(roadmapStatusLabel(level.status))}</span>
            </div>
            <h5 class="compact-title">${escapeHtml(level.title)}</h5>
            <p class="note">${escapeHtml(level.claim)}</p>
            <p class="roadmap-card-label">Модули</p>
            <ul class="roadmap-module-list">
              ${(level.modules || []).map((module) => `
                <li>
                  <strong>${escapeHtml(module.title)}</strong>
                  <span>${escapeHtml((module.skillFocus || []).join(", "))}</span>
                </li>`).join("")}
            </ul>
            <p class="roadmap-card-label">Exit evidence</p>
            <ul class="example-list">
              ${(level.exitEvidence || []).slice(0, 3).map((evidence) => `
                <li><span class="tag">${escapeHtml(evidence.skill)}</span> ${escapeHtml(evidence.evidence)}</li>`).join("")}
              ${(level.exitEvidence || []).length > 3 ? `<li class="note">Ещё ${(level.exitEvidence || []).length - 3} skill axes проверяются валидатором.</li>` : ""}
            </ul>
          </article>`).join("")}
      </div>
      ${sources.length ? `
        <p class="note roadmap-sources">
          Источники roadmap:
          ${sources.map((source) => `<a href="${escapeHtml(safeExternalUrl(source.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.name)}</a>`).join(" · ")}
        </p>` : ""}
    </section>`;
}

function roadmapStatusLabel(status) {
  return {
    "in-progress": "в работе",
    planned: "план",
    published: "опубликовано"
  }[status] || status || "план";
}

function renderResources() {
  if (!state.data.resources?.length) return "";
  return `
    <section class="section-band with-top-gap" aria-labelledby="resources-title">
      <div class="section-heading"><div><p class="eyebrow">Открытые материалы</p><h4 id="resources-title">Бесплатные ресурсы для практики</h4></div></div>
      <div class="resource-grid">
        ${state.data.resources.map((resource) => `
          <article class="resource-row">
            <span class="tag">${escapeHtml(resource.type)}</span>
            <a href="${escapeHtml(safeExternalUrl(resource.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(resource.name)}</a>
            <p class="note">${escapeHtml(resource.note)}</p>
          </article>`).join("")}
      </div>
    </section>`;
}

function buildLessonGroups() {
  const levelDefinitions = new Map((state.data.levels || []).map((level, index) => {
    const definition = typeof level === "string" ? { id: level, title: level } : level;
    return [definition.id, {
      ...definition,
      description: definition.description || definition.claim,
      order: definition.order ?? index
    }];
  }));
  const moduleDefinitions = new Map((state.data.modules || []).map((module, index) => [
    module.id,
    { ...module, level: module.level || module.levelId, order: module.order ?? index }
  ]));

  for (const lesson of state.data.lessons) {
    if (!levelDefinitions.has(lesson.level)) {
      levelDefinitions.set(lesson.level, { id: lesson.level, title: `Уровень ${lesson.level}`, order: levelDefinitions.size });
    }
    const moduleId = lesson.moduleId || `level:${lesson.level}`;
    if (!moduleDefinitions.has(moduleId)) {
      moduleDefinitions.set(moduleId, {
        id: moduleId,
        level: lesson.level,
        title: `Основы ${lesson.level}`,
        order: moduleDefinitions.size
      });
    }
  }

  return [...levelDefinitions.values()]
    .sort(compareOrder)
    .map((level) => ({
      ...level,
      modules: [...moduleDefinitions.values()]
        .filter((module) => module.level === level.id)
        .sort(compareOrder)
        .map((module) => ({
          ...module,
          lessons: state.data.lessons
            .filter((lesson) => (lesson.moduleId || `level:${lesson.level}`) === module.id)
            .sort(compareLessons)
        }))
        .filter((module) => module.lessons.length)
    }))
    .filter((level) => level.modules.length);
}

function prerequisiteMessage(prerequisites) {
  const titles = prerequisites.missing.map((id) => state.data.lessons.find((lesson) => lesson.id === id)?.title || id);
  return `Сначала заверши: ${titles.join(", ")}.`;
}

function renderLessonTile(lesson) {
  const done = state.appState.completedLessons.includes(lesson.id);
  const prerequisites = getLessonPrerequisites(lesson);
  const outOfOrder = !prerequisites.met;
  const hintId = `lesson-hint-${lesson.id}`;
  return `
    <div class="lesson-tile-row">
      <button class="lesson-tile ${done ? "done" : ""} ${outOfOrder ? "out-of-order" : ""}" type="button"
        data-lesson-id="${escapeHtml(lesson.id)}" ${outOfOrder ? `aria-describedby="${escapeHtml(hintId)}"` : ""}>
        <div class="tag-row"><span class="tag">${escapeHtml(lesson.level)}</span>${done ? `<span class="tag rose">пройден</span>` : ""}${outOfOrder ? `<span class="tag amber">не по порядку</span>` : ""}</div>
        <h4 class="compact-title">${escapeHtml(lesson.title)}</h4>
        <p class="note">${escapeHtml(lesson.goal)}</p>
        ${outOfOrder ? `<p class="lock-reason" id="${escapeHtml(hintId)}">${escapeHtml(prerequisiteMessage(prerequisites))}</p>` : ""}
      </button>
      <button class="lesson-tile-toggle ${done ? "done" : ""}" type="button" data-toggle-complete="${escapeHtml(lesson.id)}"
        title="${done ? "Снять отметку «пройден»" : "Отметить урок пройденным"}"
        aria-label="${done ? `Снять отметку «пройден» с урока ${escapeHtml(lesson.title)}` : `Отметить урок ${escapeHtml(lesson.title)} пройденным`}">${done ? "↺" : "✓"}</button>
    </div>`;
}

function compareLessons(first, second) {
  const levels = new Map((state.data.levels || []).map((level, index) => {
    const definition = typeof level === "string" ? { id: level } : level;
    return [definition.id, definition.order ?? index];
  }));
  const modules = new Map((state.data.modules || []).map((module, index) => [module.id, {
    levelId: module.levelId || module.level,
    order: module.order ?? index
  }]));
  const firstModule = modules.get(first.moduleId);
  const secondModule = modules.get(second.moduleId);
  return (levels.get(firstModule?.levelId || first.level) ?? 999) - (levels.get(secondModule?.levelId || second.level) ?? 999)
    || (firstModule?.order ?? 999) - (secondModule?.order ?? 999)
    || (first.order ?? state.data.lessons.indexOf(first)) - (second.order ?? state.data.lessons.indexOf(second));
}

function compareOrder(first, second) {
  return (first.order ?? 999) - (second.order ?? 999) || String(first.id).localeCompare(String(second.id));
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "#";
  } catch {
    return "#";
  }
}

function renderDeckOptions() {
  const introduced = new Set(getIntroducedLessonIds({
    completedLessons: [...state.appState.completedLessons, ...state.appState.legacyCompletedLessons],
    attempts: state.exerciseAttempts,
    currentLessonId: state.currentLessonId
  }));
  const options = [
    ["all", "Все карточки"], ["vocabulary", "Слова"], ["phrases", "Фразы"], ["custom", "Свои"]
  ];
  state.data.lessons
    .filter((lesson) => introduced.has(lesson.id))
    .forEach((lesson) => options.push([lesson.id, `${lesson.level} · ${lesson.title}`]));
  return options.map(([value, label]) => `<option value="${value}" ${state.reviewDeck === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function renderPronunciationDeckOptions() {
  const completed = new Set(state.pronunciationState.completedLessons);
  const options = [["all", "Все открытые уроки"]];
  for (const module of [...state.pronunciationData.modules].sort(compareOrder)) {
    options.push([module.id, `Модуль · ${module.title}`]);
  }
  for (const lesson of [...state.pronunciationData.lessons].sort(compareOrder)) {
    if (completed.has(lesson.id)) options.push([lesson.id, `Урок ${lesson.order} · ${lesson.title}`]);
  }
  return options.map(([value, label]) => `<option value="${escapeHtml(value)}" ${state.pronunciationReviewDeck === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function pronunciationKindOptions() {
  const options = [
    ["all", "Все типы"],
    ["pattern", "Сочетание → звук"],
    ["word", "Разбор слова"],
    ["rule", "Позиционное правило"],
    ["exception", "Исключение"],
    ["flow", "Стык слов"]
  ];
  return options.map(([value, label]) => `<option value="${value}" ${state.pronunciationReviewKind === value ? "selected" : ""}>${label}</option>`).join("");
}

function pronunciationKindLabel(kind) {
  return {
    pattern: "сочетание → звук",
    word: "разбор слова",
    rule: "правило",
    exception: "исключение",
    flow: "стык слов"
  }[kind] || kind;
}

function renderRatingButton(score, label, interval) {
  return `<button type="button" data-score="${score}" class="rating-button ${score}"><strong>${label}</strong><span>${escapeHtml(interval)}</span></button>`;
}

function renderReviewEmpty(summary) {
  return `<div class="empty-state"><strong>${state.reviewMode === "cram" ? "Колода закончилась" : "На сегодня всё"}</strong><p>${summary.newCount ? "Новые карточки появятся завтра или после увеличения дневного лимита." : "Добавь своё слово или продолжай урок."}</p></div>`;
}

function renderSuspendedCards(cards) {
  if (!cards.length) return "";
  return `
    <details class="with-top-gap">
      <summary>Приостановленные карточки (${cards.length})</summary>
      <div class="history-list with-top-gap">
        ${cards.map((card) => `
          <div class="history-row">
            <strong>${escapeHtml(card.front)}</strong>
            <span>${escapeHtml(card.lessonTitle)}</span>
            <button class="secondary-button" type="button" data-card-resume="${escapeHtml(card.id)}">Вернуть</button>
          </div>`).join("")}
      </div>
    </details>`;
}

function renderMetric(label, value, note) {
  return `<div class="metric"><p class="eyebrow">${escapeHtml(label)}</p><strong>${escapeHtml(value)}</strong><span>${escapeHtml(note)}</span></div>`;
}

async function markLessonComplete(lessonId) {
  const lesson = getLesson(lessonId);
  const prerequisites = getLessonPrerequisites(lesson);
  const readiness = evaluateLessonReadiness(lesson, state.exerciseAttempts, state.recordings);
  if (!prerequisites.met || !readiness.canComplete) {
    const lessonRoot = document.querySelector(".lesson-layout");
    updateLessonCompletionUI(lessonRoot, lesson);
    lessonRoot?.querySelector(".completion-status")?.focus?.();
    return;
  }
  const previousCompletedLessons = [...state.appState.completedLessons];
  const previousCurrentLessonId = state.currentLessonId;
  const previousStoredLessonId = state.appState.currentLessonId;
  if (!state.appState.completedLessons.includes(lessonId)) state.appState.completedLessons.push(lessonId);
  state.appState.completionModelVersion = 2;
  if (state.currentLessonId === lessonId) setCurrentLesson(getNextLesson()?.id || lessonId, false);
  if (!(await saveAppState())) {
    state.appState.completedLessons = previousCompletedLessons;
    state.currentLessonId = previousCurrentLessonId;
    state.appState.currentLessonId = previousStoredLessonId;
    updateLessonCompletionUI(document.querySelector(".lesson-layout"), lesson);
    return;
  }
  render();
}

async function toggleLessonCompleteFromTile(lessonId) {
  const wasDone = state.appState.completedLessons.includes(lessonId);
  const previousCompletedLessons = [...state.appState.completedLessons];
  const previousCurrentLessonId = state.currentLessonId;
  const previousStoredLessonId = state.appState.currentLessonId;
  if (wasDone) {
    state.appState.completedLessons = state.appState.completedLessons.filter((id) => id !== lessonId);
  } else {
    state.appState.completedLessons.push(lessonId);
    state.appState.completionModelVersion = 2;
    if (state.currentLessonId === lessonId) setCurrentLesson(getNextLesson()?.id || lessonId, false);
  }
  if (!(await saveAppState())) {
    state.appState.completedLessons = previousCompletedLessons;
    state.currentLessonId = previousCurrentLessonId;
    state.appState.currentLessonId = previousStoredLessonId;
    return;
  }
  render();
}

function updateLessonCompletionUI(scope, lesson) {
  if (!scope) return;
  const button = scope.querySelector(".complete-lesson");
  const status = scope.querySelector(".completion-status");
  if (!button || !status) return;
  const isDone = state.appState.completedLessons.includes(lesson.id);
  const prerequisites = getLessonPrerequisites(lesson);
  const readiness = evaluateLessonReadiness(lesson, state.exerciseAttempts, state.recordings);
  const disabled = isDone || !prerequisites.met || !readiness.canComplete;
  button.disabled = disabled;
  button.setAttribute("aria-disabled", String(disabled));
  button.textContent = isDone ? "Урок пройден" : "Отметить урок пройденным";
  status.tabIndex = -1;
  if (isDone) {
    status.textContent = "Все обязательные задания подтверждены.";
  } else if (!prerequisites.met) {
    status.textContent = prerequisiteMessage(prerequisites);
  } else if (!readiness.total) {
    status.textContent = "В уроке пока нет обязательных заданий, поэтому завершение недоступно.";
  } else if (readiness.needsReview) {
    status.textContent = `${readiness.mastered}/${readiness.total} готово. Сравни открытые ответы с примером и подтверди исправления.`;
  } else {
    status.textContent = `${readiness.mastered}/${readiness.total} обязательных заданий готово.`;
  }
}

function setCurrentLesson(lessonId, save = true) {
  state.currentLessonId = lessonId;
  state.appState.currentLessonId = lessonId;
  if (save) saveAppState();
}

function getNextLesson() {
  return [...state.data.lessons]
    .sort(compareLessons)
    .find((lesson) =>
      !state.appState.completedLessons.includes(lesson.id)
      && getLessonPrerequisites(lesson).met
    );
}

function getLessonPrerequisites(lesson) {
  return mastery.checkCatalogLessonPrerequisites(state.data, lesson, state.appState.completedLessons);
}

function getLesson(id) {
  return state.data.lessons.find((lesson) => lesson.id === id) || state.data.lessons[0];
}

function getPronunciationLesson(id) {
  return state.pronunciationData.lessons.find((lesson) => lesson.id === id) || state.pronunciationData.lessons[0];
}

function getActivePronunciationCards(allCards) {
  const completed = new Set(state.pronunciationState.completedLessons);
  return allCards
    .filter((card) => completed.has(card.lessonId))
    .filter((card) => !state.pronunciationState.suspendedCardIds.includes(card.id));
}

function getPronunciationPrerequisites(lesson) {
  const completed = new Set(state.pronunciationState.completedLessons);
  const prerequisites = Array.isArray(lesson?.prerequisites) ? lesson.prerequisites : [];
  const missingIds = prerequisites.filter((id) => !completed.has(id));
  return {
    met: missingIds.length === 0,
    missing: missingIds.map((id) => state.pronunciationData.lessons.find((item) => item.id === id)?.title || id)
  };
}

function getNextPronunciationLesson() {
  return [...state.pronunciationData.lessons]
    .sort(compareOrder)
    .find((lesson) =>
      !state.pronunciationState.completedLessons.includes(lesson.id)
      && getPronunciationPrerequisites(lesson).met
    );
}

function setCurrentPronunciationLesson(lessonId) {
  state.pronunciationLessonId = lessonId;
  state.pronunciationState.currentLessonId = lessonId;
}

async function completePronunciationLesson(lessonId) {
  const lesson = getPronunciationLesson(lessonId);
  if (!getPronunciationPrerequisites(lesson).met) return;
  const previousState = {
    completedLessons: [...state.pronunciationState.completedLessons],
    currentLessonId: state.pronunciationState.currentLessonId
  };
  const previousLessonId = state.pronunciationLessonId;
  if (!state.pronunciationState.completedLessons.includes(lessonId)) {
    state.pronunciationState.completedLessons.push(lessonId);
  }
  const next = getNextPronunciationLesson();
  setCurrentPronunciationLesson(next?.id || lessonId);
  if (!(await savePronunciationState())) {
    state.pronunciationState.completedLessons = previousState.completedLessons;
    state.pronunciationState.currentLessonId = previousState.currentLessonId;
    state.pronunciationLessonId = previousLessonId;
    return;
  }
  state.appState.scrollPositions.pronunciation = 0;
  renderPronunciation();
}

function getExerciseAttempt(id, lessonId) {
  return state.exerciseAttempts.get(id) || { id, lessonId, answer: "", createdAt: new Date().toISOString() };
}

function preserveScrollAndRender() {
  state.appState.scrollPositions[state.view] = window.scrollY;
  render();
}

function handleReviewKeyboard(event) {
  const isPronunciationReview = state.view === "pronunciation-review";
  if (!["review", "pronunciation-review"].includes(state.view) || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
  const answerVisible = isPronunciationReview ? state.pronunciationReviewAnswerVisible : state.reviewAnswerVisible;
  if ([" ", "Enter"].includes(event.key) && !answerVisible) {
    event.preventDefault();
    document.querySelector("#show-answer")?.click();
    return;
  }
  const ratingByKey = { "1": "again", "2": "hard", "3": "good", "4": "easy" };
  if (answerVisible && ratingByKey[event.key]) {
    event.preventDefault();
    document.querySelector(`[data-score="${ratingByKey[event.key]}"]`)?.click();
  }
  if (event.key.toLocaleLowerCase() === "s") {
    document.querySelector(isPronunciationReview ? "[data-pronunciation-card-skip]" : "[data-card-skip]")?.click();
  }
}

function clearReviewRefreshTimer() {
  window.clearTimeout(state.reviewRefreshTimer);
  state.reviewRefreshTimer = null;
}

function scheduleReviewRefresh(cards) {
  clearReviewRefreshTimer();
  if (state.view !== "review" || state.reviewMode === "cram") return;
  const now = Date.now();
  const nextDueAt = cards
    .map((card) => state.schedules.get(card.id))
    .filter((schedule) => schedule && !isNewSchedule(schedule))
    .map((schedule) => new Date(schedule.due).getTime())
    .filter((dueAt) => Number.isFinite(dueAt) && dueAt > now)
    .sort((left, right) => left - right)[0];
  if (!nextDueAt) return;
  state.reviewRefreshTimer = window.setTimeout(() => {
    state.reviewRefreshTimer = null;
    if (state.view === "review") {
      state.reviewAnswerVisible = false;
      renderReview();
    }
  }, Math.max(1000, nextDueAt - now + 250));
}

function schedulePronunciationReviewRefresh(cards) {
  clearReviewRefreshTimer();
  if (state.view !== "pronunciation-review" || ["cram", "catalog"].includes(state.pronunciationReviewMode)) return;
  const now = Date.now();
  const nextDueAt = cards
    .map((card) => state.schedules.get(card.id))
    .filter((schedule) => schedule && !isNewSchedule(schedule))
    .map((schedule) => new Date(schedule.due).getTime())
    .filter((dueAt) => Number.isFinite(dueAt) && dueAt > now)
    .sort((left, right) => left - right)[0];
  if (!nextDueAt) return;
  state.reviewRefreshTimer = window.setTimeout(() => {
    state.reviewRefreshTimer = null;
    if (state.view === "pronunciation-review") {
      state.pronunciationReviewAnswerVisible = false;
      renderPronunciationReview();
    }
  }, Math.max(1000, nextDueAt - now + 250));
}

function refreshReviewOnReturn() {
  if (state.view === "review") {
    state.reviewAnswerVisible = false;
    renderReview();
  } else if (state.view === "pronunciation-review") {
    state.pronunciationReviewAnswerVisible = false;
    renderPronunciationReview();
  }
}

async function migrateLegacySchedules() {
  if (await getValue("legacySchedulesMigrated", false)) return;
  const legacy = state.appState.legacyCardProgress || {};
  for (const [oldKey, progress] of Object.entries(legacy)) {
    const match = oldKey.match(/^(l\d+)-(\d+)$/);
    if (!match) continue;
    const id = `phrase:${match[1]}:${match[2]}`;
    if (state.schedules.has(id)) continue;
    const intervalDays = Math.max(1, Number(progress.intervalDays) || 1);
    const due = progress.dueAt || new Date().toISOString();
    const schedule = {
      ...createSchedule(id),
      id,
      due,
      stability: intervalDays,
      difficulty: 5,
      scheduled_days: intervalDays,
      reps: Math.max(1, Number(progress.reps) || 1),
      state: 2,
      last_review: new Date(new Date(due).getTime() - intervalDays * 86400000).toISOString()
    };
    state.schedules.set(id, schedule);
    await putRecord("schedules", schedule);
  }
  await setValue("legacySchedulesMigrated", true);
}

async function saveAppState() {
  return runSave(() => setValue("appState", state.appState));
}

async function savePronunciationState() {
  return runSave(() => setValue("pronunciationState", state.pronunciationState));
}

async function saveSettings() {
  return runSave(() => setValue("settings", state.settings));
}

function debounceSave(key, callback) {
  window.clearTimeout(state.saveTimers.get(key));
  state.pendingSaves.set(key, callback);
  showSaving();
  state.saveTimers.set(key, window.setTimeout(() => flushPendingSave(key), 250));
}

async function flushPendingSave(key) {
  window.clearTimeout(state.saveTimers.get(key));
  state.saveTimers.delete(key);
  const callback = state.pendingSaves.get(key);
  if (!callback) return true;
  state.pendingSaves.delete(key);
  return runSave(callback);
}

function flushPendingSaves() {
  return Promise.all([...state.pendingSaves.keys()].map(flushPendingSave));
}

async function runSave(callback) {
  state.activeSaveCount += 1;
  showSaving();
  try {
    await callback();
    return true;
  } catch (error) {
    showSaveError(error);
    return false;
  } finally {
    state.activeSaveCount = Math.max(0, state.activeSaveCount - 1);
    if (state.activeSaveCount === 0 && saveIndicator.dataset.saveError !== "true") showSaved();
  }
}

function showSaving() {
  saveIndicator.dataset.saveError = "false";
  saveIndicator.removeAttribute("title");
  saveIndicator.textContent = "Сохраняем…";
  saveIndicator.classList.remove("saved-flash");
}

function showSaved() {
  saveIndicator.dataset.saveError = "false";
  saveIndicator.title = state.storage.path;
  saveIndicator.textContent = "Сохранено в файл";
  saveIndicator.classList.add("saved-flash");
  window.setTimeout(() => saveIndicator.classList.remove("saved-flash"), 700);
}

function showSaveError(error) {
  saveIndicator.dataset.saveError = "true";
  saveIndicator.textContent = "Ошибка сохранения";
  saveIndicator.title = error?.message || "Файл прогресса не удалось сохранить";
  console.error("French Study save failed", error);
}

function releaseAudioUrls() {
  for (const url of state.audioUrls) URL.revokeObjectURL(url);
  state.audioUrls.clear();
}

function defaultAppState() {
  return {
    completedLessons: [],
    legacyCompletedLessons: [],
    completionModelVersion: 2,
    currentView: "today",
    currentLessonId: null,
    scrollPositions: {},
    suspendedCardIds: [],
    suspendedNoteIds: [],
    legacyCardProgress: {},
    legacyRecordingMetadata: {}
  };
}

function defaultPronunciationState() {
  return {
    completedLessons: [],
    currentLessonId: null,
    suspendedCardIds: [],
    contentVersion: null
  };
}

function normalizePronunciationState(value) {
  const saved = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const lessonIds = new Set(state.pronunciationData?.lessons?.map((lesson) => lesson.id) || []);
  const cardIds = new Set(state.pronunciationData ? buildPronunciationCards(state.pronunciationData).map((card) => card.id) : []);
  const completedLessons = [...new Set(Array.isArray(saved.completedLessons) ? saved.completedLessons : [])]
    .filter((id) => lessonIds.has(id));
  const suspendedCardIds = [...new Set(Array.isArray(saved.suspendedCardIds) ? saved.suspendedCardIds : [])]
    .filter((id) => cardIds.has(id));
  return {
    completedLessons,
    currentLessonId: lessonIds.has(saved.currentLessonId) ? saved.currentLessonId : null,
    suspendedCardIds,
    contentVersion: state.pronunciationData.meta.contentVersion
  };
}

function defaultSettings() {
  return {
    voiceURI: "fr-FR-DeniseNeural",
    voiceRate: 0.82,
    newCardsPerDay: 20,
    pronunciationNewCardsPerDay: 12,
    reviewSettingsVersion: 1
  };
}

function resultLabel(status) {
  return { correct: "верно", almost: "почти", incorrect: "попробуй ещё", open: "сравни" }[status] || status;
}

function isToday(value) {
  const date = new Date(value);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("ru", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function nl2br(value) {
  return escapeHtml(value).replaceAll("\n", "<br>");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
