import { getValue, initializeFileStorage, setValue } from "./storage.js";

const LEVELS = Object.freeze({
  a1: Object.freeze({
    id: "a1",
    label: "A1",
    title: "French Study A1",
    module: "./levels/a1/app.js",
    views: [
      ["today", "Сегодня"],
      ["lessons", "Уроки"],
      ["listening", "Аудирование"],
      ["pronunciation", "Правила чтения"],
      ["grammar", "Грамматика"],
      ["vocabulary", "Словарь"],
      ["phrases", "Фразы"],
      ["review", "Повторение"],
      ["pronunciation-review", "Повторение чтения"],
      ["progress", "Прогресс"],
      ["settings", "Настройки"]
    ]
  }),
  a2: Object.freeze({
    id: "a2",
    label: "A2",
    title: "French Study A2",
    module: "./levels/a2/app.js",
    views: [
      ["today", "Сегодня"],
      ["lessons", "Уроки"],
      ["review", "Повторение"],
      ["progress", "Прогресс"],
      ["settings", "Настройки"]
    ]
  })
});

const app = document.querySelector("#app");
const title = document.querySelector("#view-title");
const stage = document.querySelector("#course-stage");
const nav = document.querySelector(".nav-list");
const sidebarNote = document.querySelector("#sidebar-note");
const levelButton = document.querySelector("#level-switch");
const levelMenu = document.querySelector("#level-menu");

let activeLevel = LEVELS.a1;
let activeExperience = null;

void boot();

async function boot() {
  try {
    await initializeFileStorage();
    const storedLevel = await getValue("selectedLevel", "a1");
    const storedSettings = await getValue("settings", {});
    activeLevel = LEVELS[storedLevel] || LEVELS.a1;
    document.documentElement.dataset.level = activeLevel.id;
    document.title = activeLevel.title;
    renderLearnerName(storedSettings.learnerName);
    levelButton.textContent = activeLevel.label;
    title.textContent = "Сегодня";
    renderNavigation();
    renderSidebarNote();
    renderLevelMenu();
    bindLevelSwitcher();
    window.addEventListener("french-study:learner-name", (event) => renderLearnerName(event.detail));
    const module = await import(activeLevel.module);
    activeExperience = module.levelExperience || null;
  } catch (error) {
    app.innerHTML = `<div class="empty-state">Не удалось загрузить кабинет: ${escapeHtml(error.message)}</div>`;
  }
}

function renderLearnerName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  stage.textContent = name || "Ученик";
}

function renderSidebarNote() {
  sidebarNote.innerHTML = activeLevel.id === "a1"
    ? "<p>45-60 минут в день</p><strong>Фраза -&gt; произношение -&gt; мини-грамматика -&gt; output</strong>"
    : "<p>45-60 минут в день</p><strong>Связный input -&gt; новая ситуация -&gt; самостоятельный output</strong>";
}

function renderNavigation() {
  nav.innerHTML = activeLevel.views
    .map(([id, label], index) => `<button class="nav-item ${index === 0 ? "active" : ""}" type="button" data-view="${id}">${label}</button>`)
    .join("");
}

function renderLevelMenu() {
  levelMenu.innerHTML = Object.values(LEVELS)
    .map((level) => `
      <button type="button" role="menuitemradio" aria-checked="${level.id === activeLevel.id}" data-level="${level.id}">
        ${level.label}
      </button>`)
    .join("");
}

function bindLevelSwitcher() {
  levelButton.addEventListener("click", () => {
    const opening = levelMenu.hidden;
    setLevelMenuOpen(opening);
    if (opening) levelMenu.querySelector('[aria-checked="true"]')?.focus();
  });

  levelMenu.addEventListener("click", (event) => {
    const button = event.target.closest("[data-level]");
    if (!button) return;
    void chooseLevel(button.dataset.level);
  });

  document.addEventListener("click", (event) => {
    if (!levelMenu.hidden && !event.target.closest(".level-switcher")) setLevelMenuOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || levelMenu.hidden) return;
    setLevelMenuOpen(false);
    levelButton.focus();
  });
}

function setLevelMenuOpen(open) {
  levelMenu.hidden = !open;
  levelButton.setAttribute("aria-expanded", String(open));
}

async function chooseLevel(levelId) {
  const nextLevel = LEVELS[levelId];
  if (!nextLevel) return;
  setLevelMenuOpen(false);
  if (nextLevel.id === activeLevel.id) return;

  levelButton.disabled = true;
  try {
    await activeExperience?.dispose?.();
    await setValue("selectedLevel", nextLevel.id);
    window.location.reload();
  } catch (error) {
    levelButton.disabled = false;
    app.innerHTML = `<div class="empty-state">Не удалось переключить уровень: ${escapeHtml(error.message)}</div>`;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
