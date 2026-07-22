/**
 * Shared lifecycle for level experiences.
 *
 * A level owns its data and renderers. The runtime owns the common contract
 * with the shell: navigation, active-view chrome, rendering and disposal.
 * This keeps A1 stable while A2 can add its own lesson types without copying
 * another complete application shell.
 */
export function createCourseRuntime({
  viewTitles,
  getView,
  setView,
  renderers,
  beforeSwitch = () => {},
  saveView = () => {},
  beforeRender = () => {},
  afterRender = () => {},
  onDispose = () => {}
}) {
  const app = document.querySelector("#app");
  const title = document.querySelector("#view-title");
  const nav = document.querySelector(".nav-list");
  const settingsButton = document.querySelector("#open-settings");
  let bound = false;
  let disposed = false;

  function bindNavigation() {
    if (bound || disposed) return;
    nav?.addEventListener("click", handleNavigationClick);
    settingsButton?.addEventListener("click", handleSettingsClick);
    bound = true;
  }

  function handleNavigationClick(event) {
    const button = event.target.closest("[data-view]");
    if (!button || !nav?.contains(button)) return;
    void switchView(button.dataset.view);
  }

  function handleSettingsClick() {
    void switchView("settings");
  }

  function switchView(nextView) {
    if (disposed || !Object.hasOwn(viewTitles, nextView)) return Promise.resolve(false);
    const previousView = getView();
    beforeSwitch(nextView, previousView);
    setView(nextView, previousView);
    const saveResult = Promise.resolve(saveView(nextView, previousView));
    render();
    return saveResult.then(() => true);
  }

  function render() {
    if (disposed) return;
    const view = getView();
    const renderer = renderers[view];
    if (!Object.hasOwn(viewTitles, view) || typeof renderer !== "function") {
      app.innerHTML = `<div class="empty-state">Раздел «${escapeHtml(view)}» пока недоступен.</div>`;
      return;
    }
    beforeRender(view);
    title.textContent = viewTitles[view];
    nav?.querySelectorAll("[data-view]").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === view);
    });
    renderer();
    afterRender(view);
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    if (bound) {
      nav?.removeEventListener("click", handleNavigationClick);
      settingsButton?.removeEventListener("click", handleSettingsClick);
      bound = false;
    }
    await onDispose();
  }

  return Object.freeze({ bindNavigation, switchView, render, dispose });
}

export function createSaveIndicator({ getStoragePath = () => "user-data/french-study-data.json" } = {}) {
  const element = document.querySelector("#save-indicator");
  let flashTimer = null;

  function saving() {
    window.clearTimeout(flashTimer);
    element.dataset.saveError = "false";
    element.removeAttribute("title");
    element.textContent = "Сохраняем…";
    element.classList.remove("saved-flash");
  }

  function saved() {
    window.clearTimeout(flashTimer);
    element.dataset.saveError = "false";
    element.title = getStoragePath();
    element.textContent = "Сохранено в файл";
    element.classList.add("saved-flash");
    flashTimer = window.setTimeout(() => element.classList.remove("saved-flash"), 700);
  }

  function failed(error) {
    window.clearTimeout(flashTimer);
    element.dataset.saveError = "true";
    element.textContent = "Ошибка сохранения";
    element.title = error?.message || "Файл прогресса не удалось сохранить";
    console.error("French Study save failed", error);
  }

  function dispose() {
    window.clearTimeout(flashTimer);
  }

  return Object.freeze({ saving, saved, failed, dispose });
}

export function defaultSettings() {
  return {
    learnerName: "",
    voiceURI: "fr-FR-DeniseNeural",
    voiceRate: 0.82,
    newCardsPerDay: 20,
    pronunciationNewCardsPerDay: 12,
    reviewSettingsVersion: 1
  };
}

export function normalizeLearnerName(value) {
  return typeof value === "string" ? value.trim().slice(0, 40) : "";
}

export function metric(label, value, note) {
  return `<div class="metric"><p class="eyebrow">${escapeHtml(label)}</p><strong>${escapeHtml(value)}</strong><span>${escapeHtml(note)}</span></div>`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function nl2br(value) {
  return escapeHtml(value).replaceAll("\n", "<br>");
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
