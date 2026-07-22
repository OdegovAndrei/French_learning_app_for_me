import { buildAnkiTsv } from "../../anki.js";
import { buildCards, renderClozeFront, revealCloze } from "../../cards.js";
import {
  createCourseRuntime,
  createSaveIndicator,
  defaultSettings,
  downloadBlob,
  escapeHtml,
  metric,
  nl2br,
  normalizeLearnerName
} from "../../course-runtime.js";
import { validateCourseCatalog } from "../../course-validator.js";
import {
  HELP_STEP_LABELS,
  getAvailableHintCount,
  getExerciseHintLevel,
  getExerciseHints,
  getHintButtonLabel,
  getNonNegativeInteger,
  shouldUnlockNextHint
} from "../../exercise-help.js";
import { checkExercise } from "../../exercises.js";
import * as mastery from "../../mastery.js";
import { createRecordingRuntime } from "../../recording-runtime.js";
import {
  buildCumulativeReviewQueue,
  createSchedule,
  isDueSchedule,
  isNewSchedule,
  previewSchedule,
  resetSchedule,
  reviewSchedule
} from "../../srs.js";
import {
  clearDatabase,
  createLevelStorage,
  exportDatabase,
  getFileStorageInfo,
  getValue,
  importDatabase,
  normalizeCompletionModel,
  setValue,
  validateBackup
} from "../../storage.js";
import { speakFrench as synthesizeFrench } from "../../tts.js";

const app = document.querySelector("#app");
const a1Storage = createLevelStorage("a1");
const a2Storage = createLevelStorage("a2");
const MAX_BACKUP_FILE_BYTES = 250 * 1024 * 1024;
const VIEW_TITLES = Object.freeze({
  today: "Сегодня",
  lessons: "Уроки",
  review: "Повторение",
  progress: "Прогресс",
  settings: "Настройки"
});
const VOICE_OPTIONS = Object.freeze([
  { id: "fr-FR-DeniseNeural", label: "Denise (женский)" },
  { id: "fr-FR-HenriNeural", label: "Henri (мужской)" }
]);

const state = {
  data: null,
  a1Data: null,
  matrix: null,
  view: "today",
  currentLessonId: null,
  appState: defaultA2State(),
  a1AppState: defaultA1State(),
  settings: defaultSettings(),
  storage: getFileStorageInfo(),
  a1CustomNotes: [],
  a2CustomNotes: [],
  schedules: new Map(),
  reviewLogs: [],
  exerciseAttempts: new Map(),
  recordings: new Map(),
  reviewSeen: new Set(),
  reviewAnswerVisible: false,
  reviewSaving: false,
  saveTimers: new Map(),
  settingsSavePending: false
};

const saveIndicator = createSaveIndicator({ getStoragePath: () => state.storage.path });
const recordingRuntime = createRecordingRuntime({
  storage: a2Storage,
  speak: speakFrench,
  getExerciseAttempt,
  onExerciseAttemptSaved: (attempt) => {
    state.exerciseAttempts.set(attempt.id, attempt);
    updateVisibleLessonCompletion(attempt.lessonId);
  },
  onRecordingSaved: (record) => {
    state.recordings.set(record.id, record);
    updateVisibleLessonCompletion(record.lessonId);
  },
  onSaving: saveIndicator.saving,
  onSaved: saveIndicator.saved,
  onError: saveIndicator.failed
});
const courseRuntime = createCourseRuntime({
  viewTitles: VIEW_TITLES,
  getView: () => state.view,
  setView: (view) => {
    state.view = view;
    state.appState.currentView = view;
  },
  renderers: {
    today: renderToday,
    lessons: renderLessons,
    review: renderReview,
    progress: renderProgress,
    settings: renderSettings
  },
  beforeSwitch: () => {
    recordingRuntime.stopRecording();
    state.reviewSeen.clear();
    state.reviewAnswerVisible = false;
  },
  saveView: () => saveA2State(),
  beforeRender: () => recordingRuntime.releaseAudioUrls()
});

void init();

async function init() {
  try {
    const [courseResponse, matrixResponse, a1Response] = await Promise.all([
      fetch("data/a2/course.json?v=20260722-a2-block-6"),
      fetch("data/a2/can-do.json?v=20260722-a2-matrix-6"),
      fetch("data/lessons.json?v=20260722-help-ladder-1")
    ]);
    if (!courseResponse.ok) throw new Error(`Курс A2: HTTP ${courseResponse.status}`);
    if (!matrixResponse.ok) throw new Error(`Матрица A2: HTTP ${matrixResponse.status}`);
    if (!a1Response.ok) throw new Error(`Повторение A1: HTTP ${a1Response.status}`);
    [state.data, state.matrix, state.a1Data] = await Promise.all([
      courseResponse.json(),
      matrixResponse.json(),
      a1Response.json()
    ]);
    validateCourseCatalog(state.data);

    const [storedA2State, storedA1State, storedSettings, a1CustomNotes, a2CustomNotes,
      a1Schedules, a2Schedules, a1Logs, a2Logs, attempts, recordings] = await Promise.all([
      a2Storage.getValue("appState", defaultA2State()),
      a1Storage.getValue("appState", defaultA1State()),
      getValue("settings", {}),
      a1Storage.getAllRecords("vocabulary"),
      a2Storage.getAllRecords("vocabulary"),
      a1Storage.getAllRecords("schedules"),
      a2Storage.getAllRecords("schedules"),
      a1Storage.getAllRecords("reviewLogs"),
      a2Storage.getAllRecords("reviewLogs"),
      a2Storage.getAllRecords("exercises"),
      a2Storage.getAllRecords("recordings")
    ]);

    state.appState = normalizeA2State(storedA2State);
    state.a1AppState = normalizeA1State(storedA1State);
    state.settings = { ...defaultSettings(), ...storedSettings };
    state.storage = getFileStorageInfo();
    state.a1CustomNotes = a1CustomNotes;
    state.a2CustomNotes = a2CustomNotes;
    state.schedules = new Map([...a1Schedules, ...a2Schedules].map((record) => [record.id, record]));
    state.reviewLogs = [...a1Logs, ...a2Logs];
    state.exerciseAttempts = new Map(attempts.map((record) => [record.id, record]));
    state.recordings = new Map(recordings.map((record) => [record.id, record]));
    state.view = VIEW_TITLES[state.appState.currentView] ? state.appState.currentView : "today";
    state.currentLessonId = chooseCurrentLessonId();

    document.title = state.data.meta.title;
    courseRuntime.bindNavigation();
    bindLifecycle();
    courseRuntime.render();
    saveIndicator.saved();
  } catch (error) {
    app.innerHTML = `<div class="empty-state">Не удалось загрузить A2: ${escapeHtml(error.message)}</div>`;
  }
}

function bindLifecycle() {
  window.addEventListener("pagehide", flushPendingSaves);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushPendingSaves();
  });
}

function renderToday() {
  const lesson = getCurrentLesson();
  const review = getReviewSummary();
  const completed = state.appState.completedLessons.length;
  const module = getModule(lesson?.moduleId);
  const modulePhaseLabel = getModulePhaseLabel(module);
  const moduleLessons = module ? getModuleLessons(module.id) : [];
  const moduleCompleted = moduleLessons.filter((item) => state.appState.completedLessons.includes(item.id)).length;
  app.innerHTML = `
    <div class="metrics-grid today-metrics">
      <button class="metric metric-button" type="button" data-go-review>
        <p class="eyebrow">Накопительное повторение</p>
        <strong>${review.due} к повторению</strong>
        <span>A1 + A2 · ${review.newSlots} новых A2 сегодня</span>
      </button>
      <div class="metric">
        <p class="eyebrow">${module ? `Блок ${module.order} · ${escapeHtml(modulePhaseLabel)}` : "Опубликованные блоки A2"}</p>
        <strong>${completed}/${state.data.lessons.length} уроков</strong>
        <span>${module ? `${escapeHtml(module.title)} · ${moduleCompleted}/${moduleLessons.length}` : "Все уроки отмечены пройденными"}</span>
      </div>
    </div>
    ${lesson ? `
      <div class="dashboard-grid with-top-gap">
        <div id="today-lesson"></div>
        <aside class="section-band daily-plan">
          <div class="section-heading"><div><p class="eyebrow">45–60 минут</p><h4>Маршрут A2</h4></div></div>
          <ol class="example-list">
            <li>Повтори карточки A1 и A2, которые уже пора вспомнить.</li>
            <li>Сначала пойми связный материал без транскрипта или модели.</li>
            <li>Выдели новые формы и связки внутри реальной ситуации.</li>
            <li>Создай собственный связный ответ.</li>
            <li>Сравни с моделью, исправь и повтори вслух.</li>
          </ol>
          <button class="secondary-button full-button" type="button" data-go-review>Начать повторение</button>
          <button class="secondary-button full-button" type="button" data-go-progress>Матрица A2.1/A2.2</button>
        </aside>
      </div>` : `
      <section class="empty-state with-top-gap">
        <strong>Опубликованные блоки завершены</strong>
        <p>Продолжай накопительное повторение и возвращайся к любому уроку из общего списка.</p>
      </section>`}`;
  if (lesson) renderLessonInto(document.querySelector("#today-lesson"), lesson);
  document.querySelectorAll("[data-go-review]").forEach((button) => button.addEventListener("click", () => switchView("review")));
  document.querySelectorAll("[data-go-progress]").forEach((button) => button.addEventListener("click", () => switchView("progress")));
}

function renderLessons() {
  const completed = new Set(state.appState.completedLessons);
  const modules = [...state.data.modules].sort((left, right) => left.order - right.order);
  const phaseLabels = [...new Set(modules.map(getModulePhaseLabel))];
  const bilanCount = state.data.lessons.filter((lesson) => lesson.scenario.endsWith("bilan")).length;
  const regularLessonCount = state.data.lessons.length - bilanCount;
  app.innerHTML = `
    <div class="metrics-grid">
      ${metric("Опубликовано", state.data.lessons.length, `${regularLessonCount} уроков + ${bilanCount} bilan`)}
      ${metric("Пройдено", completed.size, `из ${state.data.lessons.length}`)}
      ${metric("Упражнения", state.data.lessons.flatMap((lesson) => lesson.exercises).length, "проверяемые и открытые")}
      ${metric("Блоки", modules.length, phaseLabels.join(" · "))}
    </div>
    ${modules.map((module) => {
      const lessons = getModuleLessons(module.id);
      const moduleCompleted = lessons.filter((lesson) => completed.has(lesson.id)).length;
      const phaseLabel = getModulePhaseLabel(module);
      return `<section class="section-band with-top-gap">
        <div class="section-heading">
          <div><p class="eyebrow">Блок ${module.order} · ${escapeHtml(phaseLabel)}</p><h3>${escapeHtml(module.title)}</h3></div>
          <span class="tag">${moduleCompleted}/${lessons.length}</span>
        </div>
        <p class="note">${escapeHtml(module.description)} Bilan отмечается как обычный урок в едином учебном прогрессе.</p>
        <div class="lesson-list">${lessons.map(renderLessonTile).join("")}</div>
      </section>`;
    }).join("")}
    <div id="selected-lesson" class="with-top-gap"></div>`;

  document.querySelectorAll("[data-lesson-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const lesson = getLesson(button.dataset.lessonId);
      if (!lesson) return;
      state.currentLessonId = lesson.id;
      state.appState.currentLessonId = lesson.id;
      void saveA2State();
      renderLessonInto(document.querySelector("#selected-lesson"), lesson);
      document.querySelector("#selected-lesson")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  document.querySelectorAll("[data-toggle-complete]").forEach((button) => {
    button.addEventListener("click", () => void toggleLessonComplete(button.dataset.toggleComplete));
  });
}

function renderReview() {
  const { a1Cards, a2Cards, allCards } = getActiveCardsByLevel();
  const summary = getReviewSummary({ a1Cards, a2Cards, allCards });
  const queue = buildCumulativeReviewQueue({
    reviewCards: allCards,
    newCards: a2Cards,
    schedules: state.schedules,
    logs: state.reviewLogs,
    newLimit: state.settings.newCardsPerDay,
    seen: state.reviewSeen
  }).filter((card) => !state.reviewSeen.has(card.id));
  const card = queue[0];

  app.innerHTML = `
    <section class="review-stage">
      <div class="section-heading">
        <div><p class="eyebrow">FSRS · переход A1 → A2</p><h3>Накопительное повторение</h3></div>
      </div>
      <p class="note">Просроченные карточки приходят из A1 и A2. Новые карточки вводятся только из завершённых уроков A2.</p>
      <div class="review-counters">
        <span><strong>${summary.dueA1}</strong> A1 пора</span>
        <span><strong>${summary.dueA2}</strong> A2 пора</span>
        <span><strong>${summary.newA2}</strong> новых A2</span>
        <span><strong>${queue.length}</strong> в сессии</span>
      </div>
      ${card ? renderReviewCard(card) : renderReviewEmpty(summary)}
    </section>`;

  if (card) bindReviewCard(card);
}

function renderProgress() {
  const completed = new Set(state.appState.completedLessons);
  const exercises = state.data.lessons.flatMap((lesson) => lesson.exercises);
  const blocks = state.matrix.phases.flatMap((phase) => phase.blocks);
  const publishedBlocks = blocks.filter((block) => block.status === "published").length;
  const readyExercises = exercises.filter((exercise) => {
    const lesson = state.data.lessons.find((item) => item.exercises.some((candidate) => candidate.id === exercise.id));
    return mastery.evaluateLessonReadiness(lesson, state.exerciseAttempts, state.recordings)
      .evidence.some((item) => item.exerciseId === exercise.id && item.state === "mastered");
  }).length;
  app.innerHTML = `
    <div class="metrics-grid">
      ${metric("Уроки", `${completed.size}/${state.data.lessons.length}`, `${publishedBlocks} блоков опубликовано`)}
      ${metric("Задания", `${readyExercises}/${exercises.length}`, "выполнено")}
      ${metric("Фазы", state.matrix.phases.length, "A2.1 и A2.2")}
      ${metric("Блоки", blocks.length, `${publishedBlocks} опубликовано`)}
    </div>
    <section class="section-band with-top-gap">
      <div class="section-heading"><div><p class="eyebrow">Исходная предпосылка</p><h3>Ответственное самостоятельное обучение</h3></div></div>
      <p>${escapeHtml(state.matrix.meta.assumption)}</p>
      <p class="note">${escapeHtml(state.matrix.meta.progressPolicy)}</p>
    </section>
    <div class="roadmap-grid with-top-gap">
      ${state.matrix.phases.map((phase) => `
        <section class="section-band">
          <div class="section-heading"><div><p class="eyebrow">${escapeHtml(phase.id)}</p><h3>${escapeHtml(phase.title)}</h3></div></div>
          <p>${escapeHtml(phase.outcome)}</p>
          <p class="note">${escapeHtml(phase.support)}</p>
          <div class="module-stack">
            ${phase.blocks.map((block) => `
              <article class="module-card ${block.status === "published" ? "published" : ""}">
                <div class="tag-row"><span class="tag">${block.status === "published" ? "доступен" : "план"}</span></div>
                <h4>${escapeHtml(block.title)}</h4>
                <ul class="example-list">${block.canDo.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
                <p class="note"><strong>Output:</strong> ${escapeHtml(block.output)}</p>
              </article>`).join("")}
          </div>
        </section>`).join("")}
    </div>`;
}

function renderSettings() {
  const voiceOptions = VOICE_OPTIONS.map((voice) => `
    <option value="${escapeHtml(voice.id)}" ${voice.id === state.settings.voiceURI ? "selected" : ""}>${escapeHtml(voice.label)}</option>`).join("");
  app.innerHTML = `
    <div class="settings-layout">
      <section class="section-band">
        <div class="section-heading"><div><p class="eyebrow">Профиль</p><h4>Кто изучает французский?</h4></div></div>
        <label class="field-label">Имя<input id="learner-name" type="text" maxlength="40" autocomplete="name" placeholder="Например, Анна" value="${escapeHtml(state.settings.learnerName)}" /></label>
        <p class="note">Имя и настройки произношения общие для A1 и A2.</p>
      </section>
      <section class="section-band">
        <div class="section-heading"><div><p class="eyebrow">Произношение</p><h4>Французский голос</h4></div></div>
        <label class="field-label">Голос<select class="select-control full-control" id="voice-select">${voiceOptions}</select></label>
        <label class="field-label">Скорость: <output id="voice-rate-output">${state.settings.voiceRate.toFixed(2)}</output>
          <input id="voice-rate" type="range" min="0.55" max="1.1" step="0.05" value="${state.settings.voiceRate}" />
        </label>
        <button class="secondary-button" type="button" id="test-voice">Прослушать пример</button>
      </section>
      <section class="section-band">
        <div class="section-heading"><div><p class="eyebrow">Повторение FSRS</p><h4>Новые карточки A2</h4></div></div>
        <label class="field-label">Новых заметок в день<input id="new-cards-per-day" type="number" min="0" max="1000" step="1" inputmode="numeric" value="${state.settings.newCardsPerDay}" /></label>
        <p class="note">Лимит применяется к новым карточкам A2. Карточки A1, которые уже пора повторить, продолжают появляться в очереди.</p>
      </section>
      <section class="section-band">
        <div class="section-heading"><div><p class="eyebrow">Anki</p><h4>Экспорт A2</h4></div></div>
        <button class="secondary-button" type="button" id="export-anki">Скачать карточки A2 (.tsv)</button>
      </section>
      <section class="section-band">
        <div class="section-heading"><div><p class="eyebrow">Данные на компьютере</p><h4>Единый файл прогресса</h4></div></div>
        <p class="storage-path"><code>${escapeHtml(state.storage.path)}</code></p>
        <p class="note">Резервная копия и восстановление охватывают A1, A2 и голосовые записи.</p>
        <div class="stacked-actions">
          <button class="secondary-button" type="button" id="backup-light">Лёгкая копия без аудио</button>
          <button class="secondary-button" type="button" id="backup-full">Полная копия с аудио</button>
          <label class="secondary-button file-button">Восстановить из JSON<input id="restore-backup" type="file" accept="application/json,.json" /></label>
        </div>
      </section>
      <section class="section-band danger-band">
        <div class="section-heading"><div><p class="eyebrow">Опасная зона</p><h4>Сброс кабинета</h4></div></div>
        <button class="danger-button" type="button" id="reset-progress">Удалить весь общий прогресс</button>
      </section>
    </div>`;
  bindSettingsActions();
}

function renderLessonInto(container, lesson) {
  if (!container || !lesson) return;
  const template = document.querySelector("#lesson-template").content.cloneNode(true);
  template.querySelector(".lesson-level").textContent = `${lesson.level} · ${getModulePhaseLabel(getModule(lesson.moduleId))} · ${lesson.scenario}`;
  template.querySelector(".lesson-title").textContent = lesson.title;
  template.querySelector(".lesson-goal").textContent = lesson.goal;
  template.querySelector(".lesson-objectives").innerHTML = lesson.objectives
    .map((objective) => `<li><span class="tag">${escapeHtml(objective.skill)}</span> ${escapeHtml(objective.cefrCanDo)}</li>`)
    .join("");
  template.querySelector(".complete-lesson").addEventListener("click", () => void markLessonComplete(lesson.id));
  template.querySelector(".dialogue-list").innerHTML = lesson.dialogue.map(renderDialogueLine).join("");
  template.querySelector(".lesson-vocabulary").innerHTML = renderLessonVocabulary(lesson.vocabulary);
  template.querySelector(".pronunciation-target").innerHTML = renderPronunciationTopic(lesson.pronunciationTopic);
  template.querySelector(".grammar-note").innerHTML = renderGrammarTopic(lesson.grammarTopic);
  template.querySelector(".exercise-list").innerHTML = lesson.exercises.map((exercise) => renderExercise(lesson, exercise)).join("");
  template.querySelector(".voice-lab").innerHTML = recordingRuntime.renderVoiceLab(lesson.targetPhrase, `lesson:${lesson.id}`);
  container.replaceChildren(template);
  updateLessonCompletionUI(container, lesson);
  bindLessonActions(container, lesson);
  recordingRuntime.bindVoiceLabs(container);
}

function renderLessonTile(lesson) {
  const done = state.appState.completedLessons.includes(lesson.id);
  const prerequisites = getLessonPrerequisites(lesson);
  const outOfOrder = !prerequisites.met;
  return `
    <div class="lesson-tile-row">
      <button class="lesson-tile ${done ? "done" : ""} ${outOfOrder ? "out-of-order" : ""}" type="button" data-lesson-id="${escapeHtml(lesson.id)}">
        <div class="tag-row"><span class="tag">${escapeHtml(lesson.level)}</span>${lesson.scenario.endsWith("bilan") ? `<span class="tag amber">bilan</span>` : ""}${done ? `<span class="tag rose">пройден</span>` : ""}</div>
        <h4 class="compact-title">${escapeHtml(lesson.title)}</h4>
        <p class="note">${escapeHtml(lesson.goal)}</p>
        ${outOfOrder ? `<p class="lock-reason">${escapeHtml(prerequisiteMessage(prerequisites))}</p>` : ""}
      </button>
      <button class="lesson-tile-toggle ${done ? "done" : ""}" type="button" data-toggle-complete="${escapeHtml(lesson.id)}"
        aria-label="${done ? "Снять отметку" : "Отметить пройденным"}">${done ? "↺" : "✓"}</button>
    </div>`;
}

function renderDialogueLine(line) {
  return `<article class="dialogue-line">
    <div class="speaker">${escapeHtml(line.speaker)}</div>
    <div><strong>${escapeHtml(line.fr)}</strong><button class="inline-audio" type="button" data-speak="${escapeHtml(line.fr)}" aria-label="Прослушать">▶</button><span class="ipa">${escapeHtml(line.ipa)}</span><p>${escapeHtml(line.ru)}</p></div>
  </article>`;
}

function renderLessonVocabulary(vocabulary) {
  return `<div class="lesson-vocabulary-grid">${vocabulary.map((item) => `
    <article class="lesson-vocabulary-item">
      <div><strong>${escapeHtml(item.fr)}</strong><button class="inline-audio" type="button" data-speak="${escapeHtml(item.fr)}" aria-label="Прослушать">▶</button><span class="ipa">${escapeHtml(item.ipa)}</span></div>
      <div class="translation">${escapeHtml(item.ru)}</div>
      <p class="note">${escapeHtml(item.note)}</p>
    </article>`).join("")}</div>`;
}

function renderPronunciationTopic(topicId) {
  const topic = state.data.pronunciationTopics.find((item) => item.id === topicId);
  if (!topic) return "";
  return `<h5>${escapeHtml(topic.title)}</h5><p>${escapeHtml(topic.target)}</p><p class="note">${escapeHtml(topic.cue)}</p>
    <ul class="example-list">${topic.paradigm.map((item) => `<li><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.form)}</li>`).join("")}</ul>`;
}

function renderGrammarTopic(topicId) {
  const topic = state.data.grammarTopics.find((item) => item.id === topicId);
  if (!topic) return "";
  return `<h5>${escapeHtml(topic.title)}</h5><p>${escapeHtml(topic.rule)}</p>
    <ul class="example-list">${topic.examples.map((example) => `<li>${escapeHtml(example)}</li>`).join("")}</ul>`;
}

function renderExercise(lesson, exercise) {
  const attempt = getExerciseAttempt(exercise.id, lesson.id);
  const result = attempt.result;
  const hints = getExerciseHints(exercise);
  const hintLevel = getExerciseHintLevel(attempt, hints.length);
  const availableHintCount = getAvailableHintCount(attempt, hints.length);
  const canSelfReview = isSelfReviewExercise(exercise)
    && attempt.showModel
    && result?.needsReview === true
    && result?.coverageComplete === true
    && (!isRecordingRequired(exercise) || hasExerciseRecording(attempt, exercise));
  return `<div class="exercise" data-exercise-id="${escapeHtml(exercise.id)}">
    <div class="exercise-header"><span class="tag">${escapeHtml(exercise.type)}</span>${result ? `<span class="result-badge ${escapeHtml(result.status)}">${resultLabel(result.status)}</span>` : ""}</div>
    <p><strong>${escapeHtml(exercise.prompt)}</strong></p>
    ${renderExerciseSupport(exercise, attempt.showModel)}
    <textarea placeholder="${escapeHtml(exercisePlaceholder(exercise))}">${escapeHtml(attempt.answer || "")}</textarea>
    <div class="control-row">
      <button class="primary-button compact-button" type="button" data-check-exercise>Проверить</button>
      ${hints.length ? `<button class="pill-button" type="button" data-show-hint ${hintLevel < availableHintCount ? "" : "disabled"}>${escapeHtml(getHintButtonLabel(hints.length, hintLevel, availableHintCount))}</button>` : ""}
      <button class="pill-button" type="button" data-show-model>Показать пример</button>
    </div>
    ${result ? `<div class="exercise-feedback ${escapeHtml(result.status)}">${escapeHtml(result.message)}${result.missing?.length ? `<br><strong>Добавь:</strong> ${result.missing.map(escapeHtml).join(", ")}` : ""}</div>` : ""}
    ${renderExerciseHelp(hints, hintLevel, availableHintCount)}
    ${attempt.showModel ? `<div class="model-answer"><strong>Возможный ответ</strong><p>${nl2br(exercise.modelAnswer)}</p><span>${escapeHtml(exercise.explanation)}</span></div>` : ""}
    ${isRecordingRequired(exercise) ? `<div class="exercise-recording">${recordingRuntime.renderVoiceLab(exercise.modelAnswer, `exercise:${lesson.id}:${exercise.id}`, {
      lessonId: lesson.id,
      exerciseId: exercise.id,
      minimumSeconds: exercise.minimumRecordingSeconds || 5,
      showTarget: false,
      targetAvailable: attempt.showModel === true
    })}</div>` : ""}
    ${canSelfReview ? `<button class="secondary-button self-review-button" type="button" data-self-review ${attempt.selfReviewed ? "disabled" : ""}>${attempt.selfReviewed ? "Сравнение выполнено" : "Я сравнил и исправил"}</button>` : ""}
  </div>`;
}

function renderExerciseSupport(exercise, modelVisible) {
  const parts = [];
  if (exercise.sourceText) parts.push(`<div class="exercise-source"><strong>Материал</strong><p>${nl2br(exercise.sourceText)}</p></div>`);
  if (exercise.listenText || (["listening-comprehension", "dictation"].includes(exercise.type) && exercise.transcript)) {
    parts.push(`<button class="pill-button exercise-listen" type="button" data-speak="${escapeHtml(exercise.listenText || exercise.transcript)}">▶ Прослушать</button>`);
  }
  if (exercise.interactionTurns?.length) {
    parts.push(`<div class="interaction-turns"><strong>Ходы собеседника</strong><ol>${exercise.interactionTurns.map((turn) => `<li><span class="tag">${escapeHtml(turn.speaker)}</span> ${escapeHtml(turn.prompt)}</li>`).join("")}</ol></div>`);
  }
  if (exercise.rubric?.length) parts.push(`<div class="exercise-rubric"><strong>Критерии</strong><ul>${exercise.rubric.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`);
  if (modelVisible && exercise.transcript) parts.push(`<div class="exercise-transcript"><strong>Транскрипт</strong><p>${nl2br(exercise.transcript)}</p></div>`);
  return parts.join("");
}

function renderExerciseHelp(hints, hintLevel, availableHintCount) {
  if (!hintLevel) return "";
  return `<div class="exercise-help" aria-live="polite"><strong>Помощь по шагам</strong><ol class="exercise-help-steps">
    ${hints.slice(0, hintLevel).map((hint, index) => `<li><span class="exercise-help-label">${escapeHtml(HELP_STEP_LABELS[index] || `Шаг ${index + 1}`)}</span>${escapeHtml(hint)}</li>`).join("")}
  </ol>${hintLevel < hints.length && hintLevel >= availableHintCount ? `<p class="exercise-help-next">Следующий шаг откроется после ещё одной попытки.</p>` : ""}</div>`;
}

function bindLessonActions(container, lesson) {
  container.querySelectorAll("[data-speak]").forEach((button) => {
    if (button.closest(".voice-lab-box")) return;
    button.addEventListener("click", () => speakFrench(button.dataset.speak));
  });
  container.querySelectorAll(".exercise").forEach((box) => bindExercise(box, lesson));
}

function bindExercise(box, lesson) {
  const exercise = lesson.exercises.find((item) => item.id === box.dataset.exerciseId);
  const textarea = box.querySelector("textarea");
  textarea.addEventListener("input", () => {
    const attempt = getExerciseAttempt(exercise.id, lesson.id);
    if (attempt.answer !== textarea.value) {
      delete attempt.result;
      delete attempt.checkedAt;
      attempt.selfReviewed = false;
    }
    attempt.answer = textarea.value;
    attempt.updatedAt = new Date().toISOString();
    state.exerciseAttempts.set(attempt.id, attempt);
    scheduleAttemptSave(attempt);
    updateLessonCompletionUI(box.closest(".lesson-layout"), lesson);
  });
  box.querySelector("[data-check-exercise]").addEventListener("click", async () => {
    const attempt = getExerciseAttempt(exercise.id, lesson.id);
    attempt.answer = textarea.value;
    attempt.result = checkExercise(exercise, textarea.value);
    if (shouldUnlockNextHint(attempt.result)) {
      attempt.helpFailures = getNonNegativeInteger(attempt.helpFailures) + 1;
      const hints = getExerciseHints(exercise);
      attempt.hintLevel = Math.max(getExerciseHintLevel(attempt, hints.length), getAvailableHintCount(attempt, hints.length));
    }
    attempt.selfReviewed = false;
    attempt.checkedAt = new Date().toISOString();
    state.exerciseAttempts.set(attempt.id, attempt);
    await saveAttempt(attempt);
    preserveVisibleLesson(lesson);
  });
  box.querySelector("[data-show-hint]")?.addEventListener("click", async () => {
    const attempt = getExerciseAttempt(exercise.id, lesson.id);
    const hints = getExerciseHints(exercise);
    attempt.hintLevel = Math.min(hints.length, getExerciseHintLevel(attempt, hints.length) + 1);
    state.exerciseAttempts.set(attempt.id, attempt);
    await saveAttempt(attempt);
    preserveVisibleLesson(lesson);
  });
  box.querySelector("[data-show-model]").addEventListener("click", async () => {
    const attempt = getExerciseAttempt(exercise.id, lesson.id);
    attempt.showModel = true;
    state.exerciseAttempts.set(attempt.id, attempt);
    await saveAttempt(attempt);
    preserveVisibleLesson(lesson);
  });
  box.querySelector("[data-self-review]")?.addEventListener("click", async () => {
    const attempt = getExerciseAttempt(exercise.id, lesson.id);
    if (!attempt.showModel || attempt.result?.coverageComplete !== true || (isRecordingRequired(exercise) && !hasExerciseRecording(attempt, exercise))) return;
    attempt.selfReviewed = true;
    attempt.updatedAt = new Date().toISOString();
    state.exerciseAttempts.set(attempt.id, attempt);
    await saveAttempt(attempt);
    preserveVisibleLesson(lesson);
  });
}

function preserveVisibleLesson(lesson) {
  const scroll = window.scrollY;
  const target = state.view === "today" ? document.querySelector("#today-lesson") : document.querySelector("#selected-lesson");
  if (target) renderLessonInto(target, lesson);
  requestAnimationFrame(() => window.scrollTo({ top: scroll, behavior: "instant" }));
}

function renderReviewCard(card) {
  const schedule = state.schedules.get(card.id) || createSchedule(card.id);
  const preview = previewSchedule(schedule);
  const front = card.kind === "cloze" ? renderClozeFront(card.front) : card.front;
  return `<article class="review-card" data-card-id="${escapeHtml(card.id)}">
    <div class="review-context"><span class="tag">${escapeHtml(card.storageLevel.toUpperCase())}</span> ${escapeHtml(card.lessonTitle)} · ${escapeHtml(card.kind)}</div>
    <div class="review-front">${nl2br(front)}</div>
    <div class="control-row review-primary-actions">
      <button class="icon-text-button" type="button" data-card-speak>▶ Прослушать</button>
      ${state.reviewAnswerVisible ? "" : `<button class="primary-button" type="button" id="show-answer">Показать ответ</button>`}
    </div>
    ${state.reviewAnswerVisible ? `<div class="review-back visible">${card.kind === "cloze" ? `<p class="cloze-reveal">${nl2br(revealCloze(card.front))}</p>` : ""}<p class="fr">${nl2br(card.back)}</p><div class="rating-grid">
      ${ratingButton("again", "Again", preview.again.interval)}
      ${ratingButton("hard", "Hard", preview.hard.interval)}
      ${ratingButton("good", "Good", preview.good.interval)}
      ${ratingButton("easy", "Easy", preview.easy.interval)}
    </div></div>` : ""}
    <div class="review-card-tools"><button type="button" data-card-skip>В конец сессии</button><button type="button" data-card-reset>Сбросить карточку</button></div>
  </article>`;
}

function bindReviewCard(card) {
  document.querySelector("#show-answer")?.addEventListener("click", () => {
    state.reviewAnswerVisible = true;
    renderReview();
  });
  document.querySelector("[data-card-speak]").addEventListener("click", () => speakFrench(card.audioText));
  document.querySelectorAll("[data-score]").forEach((button) => button.addEventListener("click", () => void gradeReviewCard(card, button.dataset.score)));
  document.querySelector("[data-card-skip]").addEventListener("click", () => {
    state.reviewSeen.add(card.id);
    state.reviewAnswerVisible = false;
    renderReview();
  });
  document.querySelector("[data-card-reset]").addEventListener("click", async () => {
    const schedule = resetSchedule(card.id);
    state.schedules.set(card.id, schedule);
    await storageForCard(card).putRecord("schedules", schedule);
    state.reviewSeen.add(card.id);
    state.reviewAnswerVisible = false;
    renderReview();
  });
}

async function gradeReviewCard(card, rating) {
  if (state.reviewSaving) return;
  state.reviewSaving = true;
  saveIndicator.saving();
  const schedule = state.schedules.get(card.id) || createSchedule(card.id);
  const { schedule: nextSchedule, log } = reviewSchedule(schedule, rating);
  log.id = `${card.id}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  try {
    await storageForCard(card).putReviewResult(nextSchedule, log);
    state.schedules.set(card.id, nextSchedule);
    state.reviewLogs.push(log);
    state.reviewSeen.add(card.id);
    state.reviewAnswerVisible = false;
    saveIndicator.saved();
    renderReview();
  } catch (error) {
    saveIndicator.failed(error);
  } finally {
    state.reviewSaving = false;
  }
}

function getActiveCardsByLevel() {
  const a1Cards = activeLevelCards(state.a1Data, state.a1CustomNotes, state.a1AppState, "a1");
  const a2Cards = activeLevelCards(state.data, state.a2CustomNotes, state.appState, "a2");
  return { a1Cards, a2Cards, allCards: [...a1Cards, ...a2Cards] };
}

function activeLevelCards(data, customNotes, appState, storageLevel) {
  const completed = new Set(mastery.getCompletedLessonIds(appState.completedLessons));
  const suspendedCards = new Set(appState.suspendedCardIds || []);
  const suspendedNotes = new Set(appState.suspendedNoteIds || []);
  return buildCards(data, customNotes)
    .filter((card) => (card.source === "custom" || completed.has(card.lessonId)) && !suspendedCards.has(card.id) && !suspendedNotes.has(card.noteId))
    .map((card) => ({ ...card, storageLevel }));
}

function getReviewSummary(input = getActiveCardsByLevel()) {
  const { a1Cards, a2Cards, allCards } = input;
  const dueA1 = a1Cards.filter((card) => isDueSchedule(state.schedules.get(card.id))).length;
  const dueA2 = a2Cards.filter((card) => isDueSchedule(state.schedules.get(card.id))).length;
  const newA2 = a2Cards.filter((card) => isNewSchedule(state.schedules.get(card.id))).length;
  const a2Ids = new Set(a2Cards.map((card) => card.id));
  const today = new Date().toLocaleDateString("en-CA");
  const introducedToday = new Set(state.reviewLogs
    .filter((log) => log.wasNew && a2Ids.has(log.cardId) && new Date(log.reviewedAt).toLocaleDateString("en-CA") === today)
    .map((log) => a2Cards.find((card) => card.id === log.cardId)?.noteId)
    .filter(Boolean)).size;
  return { due: dueA1 + dueA2, dueA1, dueA2, newA2, all: allCards.length, newSlots: Math.max(0, state.settings.newCardsPerDay - introducedToday) };
}

function renderReviewEmpty(summary) {
  if (!summary.all) return `<div class="empty-state"><strong>Карточки откроются после первого завершённого урока A2</strong><p>Если в A1 уже есть карточки к повторению, они также появятся здесь.</p></div>`;
  return `<div class="empty-state"><strong>Сессия завершена</strong><p>Сейчас нет просроченных карточек, а доступные новые карточки A2 на сегодня закончились.</p></div>`;
}

function ratingButton(score, label, interval) {
  return `<button class="rating-button ${score}" type="button" data-score="${score}"><strong>${label}</strong><span>${escapeHtml(interval)}</span></button>`;
}

async function markLessonComplete(lessonId) {
  const lesson = getLesson(lessonId);
  if (!lesson) return;
  if (!state.appState.completedLessons.includes(lessonId)) state.appState.completedLessons.push(lessonId);
  state.currentLessonId = getNextLesson()?.id || null;
  state.appState.currentLessonId = state.currentLessonId;
  await saveA2State();
  courseRuntime.render();
}

async function toggleLessonComplete(lessonId) {
  if (state.appState.completedLessons.includes(lessonId)) {
    state.appState.completedLessons = state.appState.completedLessons.filter((id) => id !== lessonId);
  } else {
    state.appState.completedLessons.push(lessonId);
  }
  state.currentLessonId = getNextLesson()?.id || lessonId;
  state.appState.currentLessonId = state.currentLessonId;
  await saveA2State();
  renderLessons();
}

function updateLessonCompletionUI(scope, lesson) {
  if (!scope || !lesson) return;
  const button = scope.querySelector(".complete-lesson");
  const status = scope.querySelector(".completion-status");
  if (!button || !status) return;
  const done = state.appState.completedLessons.includes(lesson.id);
  const prerequisites = getLessonPrerequisites(lesson);
  const readiness = mastery.evaluateLessonReadiness(lesson, state.exerciseAttempts, state.recordings);
  button.disabled = done;
  button.textContent = done ? "Урок пройден" : "Отметить урок пройденным";
  if (done) status.textContent = "Урок отмечен пройденным; его карточки включены в повторение.";
  else {
    const orderNote = prerequisites.met ? "" : `${prerequisiteMessage(prerequisites)} `;
    const practiceNote = readiness.needsReview
      ? `${readiness.mastered}/${readiness.total} заданий готово. Сравни открытые ответы с моделью и исправь их.`
      : `${readiness.mastered}/${readiness.total} заданий готово.`;
    status.textContent = `${orderNote}${practiceNote}`;
  }
}

function updateVisibleLessonCompletion(lessonId) {
  const lesson = getLesson(lessonId);
  if (lesson) updateLessonCompletionUI(document.querySelector(".lesson-layout"), lesson);
}

function getCurrentLesson() {
  const current = getLesson(state.currentLessonId);
  if (current && !state.appState.completedLessons.includes(current.id)) return current;
  return getNextLesson();
}

function getNextLesson() {
  return state.data.lessons.find((lesson) => !state.appState.completedLessons.includes(lesson.id));
}

function chooseCurrentLessonId() {
  const saved = getLesson(state.appState.currentLessonId);
  if (saved && !state.appState.completedLessons.includes(saved.id)) return saved.id;
  return getNextLesson()?.id || null;
}

function getLesson(id) {
  return state.data?.lessons.find((lesson) => lesson.id === id) || null;
}

function getModule(id) {
  return state.data?.modules.find((module) => module.id === id) || null;
}

function getModuleLessons(moduleId) {
  return state.data.lessons
    .filter((lesson) => lesson.moduleId === moduleId)
    .sort((left, right) => left.order - right.order);
}

function getModulePhaseLabel(module) {
  if (!module) return "A2";
  const blockId = module.id.split(":").at(-1);
  const phase = state.matrix?.phases.find((item) => item.blocks.some((block) => block.id === blockId));
  return phase?.id?.toUpperCase() || "A2";
}

function getLessonPrerequisites(lesson) {
  return mastery.checkCatalogLessonPrerequisites(state.data, lesson, state.appState.completedLessons);
}

function prerequisiteMessage(prerequisites) {
  const titles = prerequisites.missing.map((id) => getLesson(id)?.title || id);
  return `Рекомендуемый порядок: сначала ${titles.join(", ")}.`;
}

function getExerciseAttempt(id, lessonId) {
  return state.exerciseAttempts.get(id) || { id, lessonId, answer: "" };
}

function isSelfReviewExercise(exercise) {
  return ["writing", "speaking", "substitution", "controlled-production", "conversation-prompt", "debate-roleplay", "guided-writing", "message-reply", "recorded-monologue", "mediation", "roleplay", "rubric-writing", "sentence-transform", "summarize-for-a-friend"].includes(exercise.type);
}

function isRecordingRequired(exercise) {
  if (exercise.requiresRecording === false) return false;
  return ["speaking", "roleplay", "conversation-prompt", "recorded-monologue"].includes(exercise.type);
}

function hasExerciseRecording(attempt, exercise) {
  const record = state.recordings.get(attempt.recordingKey);
  return Boolean(record && Number(record.durationMs) >= Number(exercise.minimumRecordingSeconds || 5) * 1000);
}

function exercisePlaceholder(exercise) {
  if (exercise.type === "dictation") return "Запиши услышанную фразу…";
  if (["recorded-monologue", "conversation-prompt", "roleplay"].includes(exercise.type)) return "Напиши план своих реплик…";
  if (["rubric-writing", "guided-writing", "message-reply"].includes(exercise.type)) return "Напиши связный ответ по критериям…";
  return "Напиши свой ответ…";
}

function resultLabel(status) {
  return ({ correct: "верно", almost: "почти", incorrect: "исправь", open: "самопроверка", empty: "пусто" })[status] || status;
}

function scheduleAttemptSave(attempt) {
  window.clearTimeout(state.saveTimers.get(attempt.id));
  saveIndicator.saving();
  state.saveTimers.set(attempt.id, window.setTimeout(() => void saveAttempt(attempt), 250));
}

async function saveAttempt(attempt) {
  window.clearTimeout(state.saveTimers.get(attempt.id));
  state.saveTimers.delete(attempt.id);
  try {
    await a2Storage.putRecord("exercises", { ...attempt });
    saveIndicator.saved();
    return true;
  } catch (error) {
    saveIndicator.failed(error);
    return false;
  }
}

async function flushPendingSaves() {
  const attempts = [...state.saveTimers.keys()].map((id) => state.exerciseAttempts.get(id)).filter(Boolean);
  await Promise.all([
    ...attempts.map(saveAttempt),
    state.settingsSavePending ? flushSettingsSave() : Promise.resolve(true)
  ]);
}

async function saveA2State() {
  try {
    saveIndicator.saving();
    await a2Storage.setValue("appState", state.appState);
    saveIndicator.saved();
    return true;
  } catch (error) {
    saveIndicator.failed(error);
    return false;
  }
}

function switchView(view) {
  return courseRuntime.switchView(view);
}

function storageForCard(card) {
  return card.storageLevel === "a1" ? a1Storage : a2Storage;
}

function speakFrench(text) {
  return synthesizeFrench(text, { voice: state.settings.voiceURI, rate: state.settings.voiceRate });
}

function bindSettingsActions() {
  const learnerName = document.querySelector("#learner-name");
  const voiceSelect = document.querySelector("#voice-select");
  const rate = document.querySelector("#voice-rate");
  const newCards = document.querySelector("#new-cards-per-day");
  learnerName.addEventListener("input", () => {
    const name = normalizeLearnerName(learnerName.value);
    window.dispatchEvent(new CustomEvent("french-study:learner-name", { detail: name }));
    scheduleSettingsSave({ learnerName: name });
  });
  learnerName.addEventListener("change", () => {
    const name = normalizeLearnerName(learnerName.value);
    learnerName.value = name;
    void flushSettingsSave();
  });
  voiceSelect.addEventListener("change", () => void saveSettings({ voiceURI: voiceSelect.value }));
  rate.addEventListener("input", () => {
    document.querySelector("#voice-rate-output").textContent = Number(rate.value).toFixed(2);
    void saveSettings({ voiceRate: Number(rate.value) });
  });
  newCards.addEventListener("input", () => {
    const value = Number(newCards.value);
    if (newCards.value.trim() && Number.isInteger(value) && value >= 0 && value <= 1000) {
      scheduleSettingsSave({ newCardsPerDay: value });
    }
  });
  newCards.addEventListener("change", () => void saveNewCardsLimit(newCards));
  document.querySelector("#test-voice").addEventListener("click", () => speakFrench("Ce week-end, j'ai visité le marché et j'ai retrouvé des amis."));
  document.querySelector("#export-anki").addEventListener("click", () => {
    downloadBlob(new Blob([buildAnkiTsv(buildCards(state.data, state.a2CustomNotes))], { type: "text/tab-separated-values;charset=utf-8" }), "french-study-a2-anki.tsv");
  });
  document.querySelector("#backup-light").addEventListener("click", () => void downloadBackup(false));
  document.querySelector("#backup-full").addEventListener("click", () => void downloadBackup(true));
  document.querySelector("#restore-backup").addEventListener("change", restoreBackup);
  document.querySelector("#reset-progress").addEventListener("click", async () => {
    if (!window.confirm("Очистить общий файл прогресса A1 и A2? Предыдущая версия останется в backup-файле.")) return;
    await clearDatabase();
    localStorage.removeItem("frenchStudyProgress");
    window.location.reload();
  });
}

async function saveSettings(patch) {
  window.clearTimeout(state.saveTimers.get("settings"));
  state.saveTimers.delete("settings");
  state.settingsSavePending = false;
  state.settings = { ...state.settings, ...patch };
  saveIndicator.saving();
  try {
    await setValue("settings", state.settings);
    saveIndicator.saved();
  } catch (error) {
    saveIndicator.failed(error);
  }
}

function scheduleSettingsSave(patch) {
  state.settings = { ...state.settings, ...patch };
  state.settingsSavePending = true;
  saveIndicator.saving();
  window.clearTimeout(state.saveTimers.get("settings"));
  state.saveTimers.set("settings", window.setTimeout(() => void flushSettingsSave(), 250));
}

function flushSettingsSave() {
  if (!state.settingsSavePending) return Promise.resolve(true);
  return saveSettings({});
}

async function saveNewCardsLimit(input) {
  const value = Number(input.value);
  if (!Number.isInteger(value) || value < 0 || value > 1000) {
    input.value = state.settings.newCardsPerDay;
    window.alert("Укажи целое число от 0 до 1000.");
    return;
  }
  await saveSettings({ newCardsPerDay: value });
}

async function downloadBackup(includeRecordings) {
  const snapshot = await exportDatabase({ includeRecordings });
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  if (blob.size > MAX_BACKUP_FILE_BYTES) {
    window.alert("Резервная копия превышает 250 МБ.");
    return;
  }
  downloadBlob(blob, `french-study-${includeRecordings ? "full" : "light"}-${new Date().toISOString().slice(0, 10)}.json`);
}

async function restoreBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > MAX_BACKUP_FILE_BYTES) throw new Error("Файл резервной копии больше 250 МБ.");
    const snapshot = JSON.parse(await file.text());
    validateBackup(snapshot);
    if (!window.confirm("Заменить общий прогресс A1 и A2 содержимым резервной копии?")) return;
    const safetySnapshot = await exportDatabase({ includeRecordings: true });
    const safetyBlob = new Blob([JSON.stringify(safetySnapshot, null, 2)], { type: "application/json" });
    if (safetyBlob.size > MAX_BACKUP_FILE_BYTES) {
      throw new Error("Текущая полная защитная копия превышает 250 МБ. Восстановление отменено.");
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

function defaultA2State() {
  return { currentView: "today", currentLessonId: "a2-l01", completedLessons: [], suspendedCardIds: [], suspendedNoteIds: [] };
}

function defaultA1State() {
  return { currentView: "today", currentLessonId: null, completedLessons: [], suspendedCardIds: [], suspendedNoteIds: [] };
}

function normalizeA2State(value) {
  const defaults = defaultA2State();
  return {
    ...defaults,
    ...(value && typeof value === "object" ? value : {}),
    completedLessons: Array.isArray(value?.completedLessons) ? [...new Set(value.completedLessons)] : [],
    suspendedCardIds: Array.isArray(value?.suspendedCardIds) ? value.suspendedCardIds : [],
    suspendedNoteIds: Array.isArray(value?.suspendedNoteIds) ? value.suspendedNoteIds : []
  };
}

function normalizeA1State(value) {
  const defaults = defaultA1State();
  const normalized = normalizeCompletionModel(value, defaults);
  return {
    ...normalized,
    suspendedCardIds: Array.isArray(normalized.suspendedCardIds) ? normalized.suspendedCardIds : [],
    suspendedNoteIds: Array.isArray(normalized.suspendedNoteIds) ? normalized.suspendedNoteIds : []
  };
}

export const levelExperience = Object.freeze({
  async dispose() {
    await flushPendingSaves();
    await recordingRuntime.dispose();
    await courseRuntime.dispose();
    saveIndicator.dispose();
  }
});
