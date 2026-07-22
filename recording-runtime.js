import { escapeHtml } from "./course-runtime.js";

/** Shared local recording/STT controller for level runtimes. */
export function createRecordingRuntime({
  storage,
  speak,
  getExerciseAttempt,
  onExerciseAttemptSaved = () => {},
  onRecordingSaved = () => {},
  onSaving = () => {},
  onSaved = () => {},
  onError = () => {}
}) {
  let recordingContext = null;
  let recordingPending = false;
  let recordingRequestId = 0;
  const audioUrls = new Set();

  function renderVoiceLab(target, key, options = {}) {
    const showTarget = options.showTarget !== false;
    const targetAvailable = options.targetAvailable !== false;
    return `<div class="voice-lab-box" data-target="${targetAvailable ? escapeHtml(target) : ""}" data-key="${escapeHtml(key)}"
      data-target-available="${targetAvailable}"
      ${options.lessonId ? `data-lesson-id="${escapeHtml(options.lessonId)}"` : ""}
      ${options.exerciseId ? `data-exercise-id="${escapeHtml(options.exerciseId)}"` : ""}
      ${options.minimumSeconds ? `data-minimum-seconds="${escapeHtml(options.minimumSeconds)}"` : ""}>
      ${showTarget ? `<p class="target-phrase">${escapeHtml(target)}</p>` : ""}
      <div class="control-row">
        ${targetAvailable ? `<button class="secondary-button compact-button" type="button" data-speak>▶ Прослушать</button>` : ""}
        <button class="primary-button compact-button" type="button" data-record-start>Записать</button>
        <button class="secondary-button compact-button" type="button" data-record-stop disabled>Стоп</button>
        <button class="pill-button" type="button" data-transcribe>Распознать запись</button>
      </div>
      <p class="recording-status note">Запись хранится локально в общем файле прогресса.</p>
      <audio controls hidden></audio>
      <p class="transcript-output note" aria-live="polite"></p>
    </div>`;
  }

  function bindVoiceLabs(scope = document) {
    scope.querySelectorAll(".voice-lab-box").forEach((box) => {
      const target = box.dataset.target;
      const key = box.dataset.key;
      const targetAvailable = box.dataset.targetAvailable !== "false";
      const startButton = box.querySelector("[data-record-start]");
      const stopButton = box.querySelector("[data-record-stop]");
      const status = box.querySelector(".recording-status");
      const audio = box.querySelector("audio");
      box.querySelector("[data-speak]")?.addEventListener("click", () => speak(target));
      const lessonId = box.dataset.lessonId || null;
      const exerciseId = box.dataset.exerciseId || null;
      const minimumSeconds = Number(box.dataset.minimumSeconds || 0);
      startButton.addEventListener("click", () => startRecording({
        key, status, audio, startButton, stopButton, lessonId, exerciseId, minimumSeconds
      }));
      stopButton.addEventListener("click", stopRecording);
      const transcribeButton = box.querySelector("[data-transcribe]");
      transcribeButton.addEventListener("click", () => transcribeRecording(
        key,
        target,
        targetAvailable,
        box.querySelector(".transcript-output"),
        transcribeButton
      ));
      void restoreRecording(key, audio, status);
    });
  }

  async function startRecording(context) {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      context.status.textContent = "Запись недоступна в этом браузере.";
      return;
    }
    if (recordingPending || recordingContext?.recorder?.state === "recording") {
      context.status.textContent = "Сначала останови текущую запись.";
      return;
    }
    const requestId = ++recordingRequestId;
    recordingPending = true;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (requestId !== recordingRequestId) {
        stopMediaStream(stream);
        return;
      }
      const recorder = new MediaRecorder(stream);
      const recording = { ...context, stream, recorder, chunks: [], startedAt: Date.now() };
      recordingContext = recording;
      recordingPending = false;
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) recording.chunks.push(event.data);
      });
      recorder.addEventListener("stop", () => void saveFinishedRecording(recording));
      recorder.start();
      setRecordingButtonsDisabled(true, context.startButton);
      context.status.textContent = "Идёт запись…";
      context.startButton.disabled = true;
      context.stopButton.disabled = false;
    } catch (error) {
      stopMediaStream(stream);
      if (requestId === recordingRequestId) {
        recordingPending = false;
        recordingContext = null;
      }
      context.status.textContent = `Нет доступа к микрофону: ${error.message}`;
    }
  }

  function stopRecording() {
    recordingRequestId += 1;
    recordingPending = false;
    const recording = recordingContext;
    if (!recording) return;
    if (recording.recorder?.state === "recording") recording.recorder.stop();
    stopMediaStream(recording.stream);
    if (recording.startButton?.isConnected) recording.startButton.disabled = true;
    if (recording.stopButton?.isConnected) recording.stopButton.disabled = true;
    if (recording.status?.isConnected) recording.status.textContent = "Останавливаем и сохраняем запись…";
  }

  async function saveFinishedRecording(recording) {
    stopMediaStream(recording.stream);
    const blob = new Blob(recording.chunks, { type: recording.recorder.mimeType || "audio/webm" });
    try {
      onSaving();
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
      await storage.putRecordingResult(record, exerciseAttempt);
      onRecordingSaved(record);
      if (exerciseAttempt) onExerciseAttemptSaved(exerciseAttempt);
      if (recording.audio?.isConnected) setAudioSource(recording.audio, blob);
      if (recording.status?.isConnected) {
        recording.status.textContent = recording.minimumSeconds && durationMs < recording.minimumSeconds * 1000
          ? `Запись сохранена, но она короче ${recording.minimumSeconds} сек. Запиши ещё раз.`
          : "Запись сохранена локально.";
      }
      onSaved();
    } catch (error) {
      if (recording.status?.isConnected) recording.status.textContent = `Не удалось сохранить запись: ${error.message}`;
      onError(error);
    } finally {
      if (recording.startButton?.isConnected) recording.startButton.disabled = false;
      if (recording.stopButton?.isConnected) recording.stopButton.disabled = true;
      if (recordingContext === recording) recordingContext = null;
      setRecordingButtonsDisabled(recordingContext?.recorder?.state === "recording", recordingContext?.startButton || null);
    }
  }

  async function restoreRecording(key, audio, status) {
    const record = await storage.getRecord("recordings", key);
    if (!record?.blob || !audio.isConnected) return;
    setAudioSource(audio, record.blob);
    status.textContent = `Последняя запись: ${formatDateTime(record.updatedAt)}`;
  }

  function setAudioSource(audio, blob) {
    const url = URL.createObjectURL(blob);
    audioUrls.add(url);
    audio.src = url;
    audio.hidden = false;
  }

  async function transcribeRecording(key, target, targetAvailable, output, button) {
    const recording = await storage.getRecord("recordings", key);
    if (!recording?.blob) {
      output.textContent = "Сначала запиши и сохрани свою фразу.";
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
      output.innerHTML = `<strong>Распознано:</strong> ${escapeHtml(result.transcript)}${targetAvailable ? `<br><span class="note">Цель: ${escapeHtml(target)}</span>` : ""}`;
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

  function releaseAudioUrls() {
    for (const url of audioUrls) URL.revokeObjectURL(url);
    audioUrls.clear();
  }

  async function dispose() {
    stopRecording();
    releaseAudioUrls();
  }

  return Object.freeze({ renderVoiceLab, bindVoiceLabs, stopRecording, releaseAudioUrls, dispose });
}

function setRecordingButtonsDisabled(disabled, activeButton = null) {
  document.querySelectorAll("[data-record-start]").forEach((button) => {
    button.disabled = disabled && button !== activeButton;
  });
}

function stopMediaStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "сохранена" : date.toLocaleString("ru-RU");
}
