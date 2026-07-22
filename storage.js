const DB_NAME = "FrenchStudyDB";
export const DB_VERSION = 2;

export const STORE_NAMES = [
  "kv",
  "vocabulary",
  "schedules",
  "reviewLogs",
  "exercises",
  "recordings"
];

export const CACHE_STORE_NAMES = ["ttsAudio"];

export const ALL_STORE_NAMES = [...STORE_NAMES, ...CACHE_STORE_NAMES];

const FILE_STORAGE_ENDPOINT = "/api/storage";
const LEGACY_A1_LEVEL = "a1";
const LEVEL_ID_PATTERN = /^[a-z][0-9](?:[._-][a-z0-9]+)*$/;
const SCOPED_LEVEL_PREFIX_PATTERN = /^[a-z][0-9](?:[._-][a-z0-9]+)*:/;

let databasePromise;
let fileStorageReady = false;
let fileStorageInfo = {
  path: "user-data/french-study-data.json",
  migratedLocalData: false
};

export async function initializeFileStorage() {
  const remote = await fileStorageRequest(FILE_STORAGE_ENDPOINT);
  let snapshot = remote.snapshot;
  let migratedLocalData = false;

  if (!remote.exists) {
    const localSnapshot = await exportDatabase({ includeRecordings: true });
    validateBackup(localSnapshot);
    const initialized = await fileStorageRequest(FILE_STORAGE_ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot: localSnapshot, initializeOnly: true })
    });
    snapshot = initialized.snapshot;
    migratedLocalData = Boolean(initialized.created && snapshotHasRecords(localSnapshot));
  }

  validateBackup(snapshot);
  await replaceIndexedDatabase(snapshot);
  fileStorageReady = true;
  fileStorageInfo = {
    path: remote.storagePath || fileStorageInfo.path,
    migratedLocalData
  };
  return { ...fileStorageInfo };
}

export function getFileStorageInfo() {
  return { ...fileStorageInfo, ready: fileStorageReady };
}

export function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.addEventListener("upgradeneeded", () => {
        const database = request.result;
        for (const name of ALL_STORE_NAMES) {
          if (!database.objectStoreNames.contains(name)) {
            database.createObjectStore(name, { keyPath: name === "kv" ? "key" : "id" });
          }
        }
      });
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });
  }
  return databasePromise;
}

export async function getRecord(storeName, id) {
  return runRequest(storeName, "readonly", (store) => store.get(id));
}

export async function getAllRecords(storeName) {
  return runRequest(storeName, "readonly", (store) => store.getAll());
}

export async function putRecord(storeName, value) {
  if (STORE_NAMES.includes(storeName)) {
    await syncFileTransaction({ puts: [{ store: storeName, record: value }] });
  }
  await runRequest(storeName, "readwrite", (store) => store.put(value));
  return value;
}

export async function deleteRecord(storeName, id) {
  if (STORE_NAMES.includes(storeName)) {
    await syncFileTransaction({ deletes: [{ store: storeName, id }] });
  }
  await runRequest(storeName, "readwrite", (store) => store.delete(id));
}

export async function getValue(key, fallback = null) {
  const record = await getRecord("kv", key);
  return record ? record.value : fallback;
}

export async function setValue(key, value) {
  return putRecord("kv", { key, value });
}

/**
 * Creates a level-local view of the study stores.
 *
 * A1 deliberately keeps its established keys and identifiers, so existing
 * learner data remains readable without a migration. Records for every other
 * level are namespaced before they reach IndexedDB or the shared backup file.
 */
export function createLevelStorage(levelId) {
  assertLevelId(levelId);

  return Object.freeze({
    levelId,
    getValue: (key, fallback = null) => getValue(scopeKey(levelId, key), fallback),
    setValue: (key, value) => setValue(scopeKey(levelId, key), value),
    getRecord: async (storeName, id) => {
      const record = await getRecord(storeName, scopeId(levelId, id));
      return record ? unscopeRecord(levelId, storeName, record) : record;
    },
    getAllRecords: async (storeName) => {
      const records = await getAllRecords(storeName);
      return records
        .filter((record) => belongsToLevel(levelId, storeName, record))
        .map((record) => unscopeRecord(levelId, storeName, record));
    },
    putRecord: (storeName, record) => putRecord(storeName, scopeRecord(levelId, storeName, record)),
    deleteRecord: (storeName, id) => deleteRecord(storeName, scopeId(levelId, id)),
    putReviewResult: (schedule, log) => putReviewResult(
      scopeRecord(levelId, "schedules", schedule),
      scopeRecord(levelId, "reviewLogs", log)
    ),
    putRecordingResult: (recording, exerciseAttempt = null) => putRecordingResult(
      scopeRecord(levelId, "recordings", recording),
      exerciseAttempt ? scopeRecord(levelId, "exercises", exerciseAttempt) : null
    )
  });
}

export function getLevelStorageKey(levelId, key) {
  assertLevelId(levelId);
  return scopeKey(levelId, key);
}

export function getLevelStorageId(levelId, id) {
  assertLevelId(levelId);
  return scopeId(levelId, id);
}

function assertLevelId(levelId) {
  if (typeof levelId !== "string" || !LEVEL_ID_PATTERN.test(levelId)) {
    throw new Error(`Неизвестный уровень хранилища: ${String(levelId)}.`);
  }
}

function scopeKey(levelId, key) {
  return levelId === LEGACY_A1_LEVEL ? key : `${levelId}:${key}`;
}

function scopeId(levelId, id) {
  return levelId === LEGACY_A1_LEVEL ? id : `${levelId}:${id}`;
}

function belongsToLevel(levelId, storeName, record) {
  const identifier = storeName === "kv" ? record?.key : record?.id;
  if (typeof identifier !== "string") return false;
  return levelId === LEGACY_A1_LEVEL
    ? !SCOPED_LEVEL_PREFIX_PATTERN.test(identifier)
    : identifier.startsWith(`${levelId}:`);
}

function scopeRecord(levelId, storeName, record) {
  const scoped = { ...record };
  const idField = storeName === "kv" ? "key" : "id";
  scoped[idField] = levelId === LEGACY_A1_LEVEL
    ? scoped[idField]
    : scopeId(levelId, scoped[idField]);
  if (levelId === LEGACY_A1_LEVEL) return scoped;

  if (storeName === "reviewLogs" && typeof scoped.cardId === "string") {
    scoped.cardId = scopeId(levelId, scoped.cardId);
  }
  if (storeName === "exercises" && typeof scoped.recordingKey === "string") {
    scoped.recordingKey = scopeId(levelId, scoped.recordingKey);
  }
  return scoped;
}

function unscopeRecord(levelId, storeName, record) {
  const unscoped = { ...record };
  if (levelId === LEGACY_A1_LEVEL) return unscoped;
  const idField = storeName === "kv" ? "key" : "id";
  const prefixLength = `${levelId}:`.length;
  unscoped[idField] = unscoped[idField].slice(prefixLength);

  if (storeName === "reviewLogs" && typeof unscoped.cardId === "string") {
    unscoped.cardId = unscoped.cardId.slice(prefixLength);
  }
  if (storeName === "exercises" && typeof unscoped.recordingKey === "string") {
    unscoped.recordingKey = unscoped.recordingKey.slice(prefixLength);
  }
  return unscoped;
}

export async function putReviewResult(schedule, log) {
  await syncFileTransaction({
    puts: [
      { store: "schedules", record: schedule },
      { store: "reviewLogs", record: log }
    ]
  });
  const database = await openDatabase();
  const transaction = database.transaction(["schedules", "reviewLogs"], "readwrite");
  transaction.objectStore("schedules").put(schedule);
  transaction.objectStore("reviewLogs").put(log);
  await transactionDone(transaction);
}

export async function putRecordingResult(recording, exerciseAttempt = null) {
  const stores = exerciseAttempt ? ["recordings", "exercises"] : ["recordings"];
  const puts = [{ store: "recordings", record: recording }];
  if (exerciseAttempt) puts.push({ store: "exercises", record: exerciseAttempt });
  await syncFileTransaction({ puts });
  const database = await openDatabase();
  const transaction = database.transaction(stores, "readwrite");
  transaction.objectStore("recordings").put(recording);
  if (exerciseAttempt) transaction.objectStore("exercises").put(exerciseAttempt);
  await transactionDone(transaction);
}

export async function migrateLegacyProgress(defaultAppState) {
  const done = await getValue("legacyMigrationDone", false);
  if (done) {
    const saved = await getValue("appState", defaultAppState);
    const normalized = normalizeCompletionModel(saved, defaultAppState);
    if (JSON.stringify(normalized) !== JSON.stringify(saved)) {
      await setValue("appState", normalized);
    }
    return normalized;
  }

  let legacy = null;
  try {
    legacy = JSON.parse(localStorage.getItem("frenchStudyProgress") || "null");
  } catch {
    legacy = null;
  }

  const current = await getValue("appState", defaultAppState);
  const migrated = normalizeCompletionModel({
    ...current,
    completedLessons: Array.isArray(legacy?.completedLessons)
      ? legacy.completedLessons
      : current.completedLessons,
    completionModelVersion: Array.isArray(legacy?.completedLessons)
      ? undefined
      : current.completionModelVersion,
    legacyCardProgress: legacy?.cards || current.legacyCardProgress || {},
    legacyRecordingMetadata: legacy?.recordings || current.legacyRecordingMetadata || {}
  }, defaultAppState);

  await setValue("appState", migrated);
  await setValue("legacyMigrationDone", true);
  return migrated;
}

export function normalizeCompletionModel(appState, defaultAppState = {}) {
  const saved = isPlainObject(appState) ? appState : {};
  const normalized = { ...defaultAppState, ...saved };
  const completedLessons = uniqueStrings([
    ...(Array.isArray(normalized.legacyCompletedLessons) ? normalized.legacyCompletedLessons : []),
    ...(Array.isArray(normalized.completedLessons) ? normalized.completedLessons : [])
  ]);
  return {
    ...normalized,
    completionModelVersion: 2,
    legacyCompletedLessons: [],
    completedLessons
  };
}

export async function exportDatabase({ includeRecordings = true } = {}) {
  const stores = {};
  for (const name of STORE_NAMES) {
    if (name === "recordings" && !includeRecordings) {
      stores[name] = [];
      continue;
    }
    const records = await getAllRecords(name);
    stores[name] = await Promise.all(records.map(serializeBinaryFields));
  }
  return {
    format: "french-study-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    includesRecordings: includeRecordings,
    stores
  };
}

export function validateBackup(snapshot) {
  if (!snapshot || snapshot.format !== "french-study-backup" || snapshot.version !== 1) {
    throw new Error("Это не резервная копия French Study версии 1.");
  }
  if (!snapshot.stores || typeof snapshot.stores !== "object") {
    throw new Error("В резервной копии отсутствует раздел stores.");
  }
  for (const name of STORE_NAMES) {
    if (!Array.isArray(snapshot.stores[name])) {
      throw new Error(`Повреждён раздел ${name}.`);
    }
    const seenIds = new Set();
    for (const [index, record] of snapshot.stores[name].entries()) {
      validateStoreRecord(name, record, index);
      const id = name === "kv" ? record.key : record.id;
      if (seenIds.has(id)) throw new Error(`Раздел ${name} содержит повторяющийся ключ ${id}.`);
      seenIds.add(id);
    }
  }
  return true;
}

function validateStoreRecord(storeName, record, index) {
  if (!isPlainObject(record)) throw new Error(`Раздел ${storeName}, запись ${index + 1}: ожидается объект.`);
  const idField = storeName === "kv" ? "key" : "id";
  if (!isNonEmptyString(record[idField])) {
    throw new Error(`Раздел ${storeName}, запись ${index + 1}: отсутствует ${idField}.`);
  }

  if (storeName === "kv") validateKeyValueRecord(record);
  if (storeName === "vocabulary") validateVocabularyRecord(record);
  if (storeName === "schedules") validateScheduleRecord(record);
  if (storeName === "reviewLogs") validateReviewLogRecord(record);
  if (storeName === "exercises") validateExerciseRecord(record);
  if (storeName === "recordings") validateRecordingRecord(record);
}

function validateKeyValueRecord(record) {
  if (!("value" in record)) throw new Error(`Настройка ${record.key} не содержит value.`);
  const scopedPrefix = record.key.match(SCOPED_LEVEL_PREFIX_PATTERN)?.[0] || "";
  const logicalKey = scopedPrefix ? record.key.slice(scopedPrefix.length) : record.key;
  if (logicalKey === "appState") validateAppState(record.value);
  if (logicalKey === "pronunciationState") validatePronunciationState(record.value);
  if (logicalKey === "settings") validateSettings(record.value);
  if (["legacyMigrationDone", "legacySchedulesMigrated"].includes(logicalKey) && typeof record.value !== "boolean") {
    throw new Error(`Настройка ${record.key} должна быть логическим значением.`);
  }
  if (record.key === "selectedLevel" && !["a1", "a2"].includes(record.value)) {
    throw new Error("selectedLevel должен быть «a1» или «a2».");
  }
}

function validateAppState(value) {
  if (!isPlainObject(value)) throw new Error("appState должен быть объектом.");
  validateOptionalStringArray(value, "completedLessons", "appState");
  validateOptionalStringArray(value, "legacyCompletedLessons", "appState");
  validateOptionalStringArray(value, "suspendedCardIds", "appState");
  validateOptionalStringArray(value, "suspendedNoteIds", "appState");
  if (value.currentView != null && !isNonEmptyString(value.currentView)) throw new Error("appState.currentView должен быть строкой.");
  if (value.currentLessonId != null && !isNonEmptyString(value.currentLessonId)) throw new Error("appState.currentLessonId должен быть строкой или null.");
  if (value.completionModelVersion != null && ![1, 2].includes(value.completionModelVersion)) {
    throw new Error("appState.completionModelVersion должен быть равен 1 или 2.");
  }
  if (value.scrollPositions != null) {
    if (!isPlainObject(value.scrollPositions)) throw new Error("appState.scrollPositions должен быть объектом.");
    for (const position of Object.values(value.scrollPositions)) {
      if (!Number.isFinite(position) || position < 0) throw new Error("appState.scrollPositions содержит неверную позицию.");
    }
  }
  for (const field of ["legacyCardProgress", "legacyRecordingMetadata"]) {
    if (value[field] != null && !isPlainObject(value[field])) throw new Error(`appState.${field} должен быть объектом.`);
  }
}

function validatePronunciationState(value) {
  if (!isPlainObject(value)) throw new Error("pronunciationState должен быть объектом.");
  validateOptionalStringArray(value, "completedLessons", "pronunciationState");
  validateOptionalStringArray(value, "suspendedCardIds", "pronunciationState");
  if (value.currentLessonId != null && !isNonEmptyString(value.currentLessonId)) {
    throw new Error("pronunciationState.currentLessonId должен быть строкой или null.");
  }
  if (value.contentVersion != null && !isNonEmptyString(value.contentVersion)) {
    throw new Error("pronunciationState.contentVersion должен быть строкой или null.");
  }
}

function validateSettings(value) {
  if (!isPlainObject(value)) throw new Error("settings должен быть объектом.");
  if (value.learnerName != null && (typeof value.learnerName !== "string" || value.learnerName.length > 40)) {
    throw new Error("settings.learnerName должен быть строкой не длиннее 40 символов.");
  }
  if (value.voiceURI != null && typeof value.voiceURI !== "string") throw new Error("settings.voiceURI должен быть строкой.");
  if (value.voiceRate != null && (!Number.isFinite(value.voiceRate) || value.voiceRate < 0.1 || value.voiceRate > 3)) {
    throw new Error("settings.voiceRate находится вне допустимого диапазона.");
  }
  if (value.newCardsPerDay != null && (!Number.isInteger(value.newCardsPerDay) || value.newCardsPerDay < 0 || value.newCardsPerDay > 1000)) {
    throw new Error("settings.newCardsPerDay должен быть целым числом от 0 до 1000.");
  }
  if (value.pronunciationNewCardsPerDay != null && (!Number.isInteger(value.pronunciationNewCardsPerDay) || value.pronunciationNewCardsPerDay < 0 || value.pronunciationNewCardsPerDay > 1000)) {
    throw new Error("settings.pronunciationNewCardsPerDay должен быть целым числом от 0 до 1000.");
  }
  if (value.reviewSettingsVersion != null && value.reviewSettingsVersion !== 1) {
    throw new Error("settings.reviewSettingsVersion должен быть равен 1.");
  }
}

function validateVocabularyRecord(record) {
  for (const field of ["fr", "ru"]) {
    if (!isNonEmptyString(record[field])) throw new Error(`Словарная запись ${record.id}: поле ${field} обязательно.`);
  }
  for (const field of ["ipa", "note", "lessonId", "lessonTitle", "source", "createdAt", "updatedAt"]) {
    if (record[field] != null && typeof record[field] !== "string") throw new Error(`Словарная запись ${record.id}: поле ${field} должно быть строкой.`);
  }
  validateOptionalStringArray(record, "tags", `Словарная запись ${record.id}`);
  if (record.directions != null) {
    validateOptionalStringArray(record, "directions", `Словарная запись ${record.id}`);
    if (record.directions.some((direction) => !["ru-fr", "fr-ru"].includes(direction))) {
      throw new Error(`Словарная запись ${record.id}: неизвестное направление.`);
    }
  }
}

function validateScheduleRecord(record) {
  if (!isDateString(record.due)) throw new Error(`Расписание ${record.id}: неверная дата due.`);
  if (record.last_review != null && !isDateString(record.last_review)) throw new Error(`Расписание ${record.id}: неверная дата last_review.`);
  if (!Number.isInteger(record.state) || record.state < 0 || record.state > 3) {
    throw new Error(`Расписание ${record.id}: state должен быть целым числом от 0 до 3.`);
  }
  if (!Number.isFinite(record.stability) || record.stability < 0) {
    throw new Error(`Расписание ${record.id}: stability должна быть неотрицательным числом.`);
  }
  const minimumDifficulty = record.state === 0 ? 0 : 1;
  if (!Number.isFinite(record.difficulty) || record.difficulty < minimumDifficulty || record.difficulty > 10) {
    throw new Error(`Расписание ${record.id}: difficulty находится вне допустимого диапазона.`);
  }
  for (const field of ["elapsed_days", "scheduled_days", "learning_steps", "reps", "lapses"]) {
    if (!Number.isInteger(record[field]) || record[field] < 0) {
      throw new Error(`Расписание ${record.id}: поле ${field} должно быть неотрицательным целым числом.`);
    }
  }
}

function validateReviewLogRecord(record) {
  if (!isNonEmptyString(record.cardId)) throw new Error(`История ${record.id}: отсутствует cardId.`);
  if (!isDateString(record.reviewedAt)) throw new Error(`История ${record.id}: неверная дата reviewedAt.`);
  if (record.rating != null && !["again", "hard", "good", "easy"].includes(record.rating)) {
    throw new Error(`История ${record.id}: неизвестная оценка.`);
  }
}

function validateExerciseRecord(record) {
  if (record.lessonId != null && typeof record.lessonId !== "string") throw new Error(`Упражнение ${record.id}: lessonId должен быть строкой.`);
  if (record.answer != null && typeof record.answer !== "string") throw new Error(`Упражнение ${record.id}: answer должен быть строкой.`);
  for (const field of ["createdAt", "updatedAt", "checkedAt"]) {
    if (record[field] != null && !isDateString(record[field])) throw new Error(`Упражнение ${record.id}: неверная дата ${field}.`);
  }
  if (record.result != null && !isPlainObject(record.result)) throw new Error(`Упражнение ${record.id}: result должен быть объектом.`);
  if (record.recordingKey != null && typeof record.recordingKey !== "string") throw new Error(`Упражнение ${record.id}: recordingKey должен быть строкой.`);
}

function validateRecordingRecord(record) {
  if (record.updatedAt != null && !isDateString(record.updatedAt)) throw new Error(`Запись ${record.id}: неверная дата updatedAt.`);
  if (record.size != null && (!Number.isFinite(record.size) || record.size < 0)) throw new Error(`Запись ${record.id}: неверный размер.`);
  if (record.blobBase64 != null) {
    if (typeof record.blobBase64 !== "string" || record.blobBase64.length > 350 * 1024 * 1024) {
      throw new Error(`Запись ${record.id}: повреждены аудиоданные.`);
    }
    if (record.blobBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(record.blobBase64)) {
      throw new Error(`Запись ${record.id}: аудиоданные не являются base64.`);
    }
  }
  if (record.blobType != null && typeof record.blobType !== "string") throw new Error(`Запись ${record.id}: blobType должен быть строкой.`);
  for (const field of ["lessonId", "exerciseId"]) {
    if (record[field] != null && typeof record[field] !== "string") throw new Error(`Запись ${record.id}: ${field} должен быть строкой.`);
  }
  if (record.durationMs != null && (!Number.isFinite(record.durationMs) || record.durationMs < 0 || record.durationMs > 120000)) {
    throw new Error(`Запись ${record.id}: неверная длительность.`);
  }
}

function validateOptionalStringArray(object, field, label) {
  if (object[field] == null) return;
  if (!Array.isArray(object[field]) || object[field].some((item) => typeof item !== "string")) {
    throw new Error(`${label}.${field} должен быть массивом строк.`);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isDateString(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function uniqueStrings(value) {
  return Array.isArray(value) ? [...new Set(value.filter((item) => typeof item === "string" && item.trim()))] : [];
}

export async function importDatabase(snapshot) {
  validateBackup(snapshot);
  if (fileStorageReady) {
    await fileStorageRequest(FILE_STORAGE_ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot, initializeOnly: false })
    });
  }
  await replaceIndexedDatabase(snapshot);
}

async function replaceIndexedDatabase(snapshot) {
  const restoredStores = {};
  for (const name of STORE_NAMES) {
    restoredStores[name] = await Promise.all(snapshot.stores[name].map(deserializeBinaryFields));
  }
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAMES, "readwrite");

  for (const name of STORE_NAMES) {
    const store = transaction.objectStore(name);
    store.clear();
    for (const record of restoredStores[name]) store.put(record);
  }

  await transactionDone(transaction);
}

export async function clearDatabase() {
  await syncFileTransaction({ clearStores: STORE_NAMES });
  const database = await openDatabase();
  const transaction = database.transaction(ALL_STORE_NAMES, "readwrite");
  for (const name of ALL_STORE_NAMES) transaction.objectStore(name).clear();
  await transactionDone(transaction);
}

async function runRequest(storeName, mode, operation) {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, mode);
  const request = operation(transaction.objectStore(storeName));
  const result = await requestDone(request);
  await transactionDone(transaction);
  return result;
}

async function syncFileTransaction({ puts = [], deletes = [], clearStores = [] }) {
  if (!fileStorageReady) return;
  const serializedPuts = await Promise.all(puts.map(async ({ store, record }) => ({
    store,
    record: await serializeBinaryFields(record)
  })));
  await fileStorageRequest(`${FILE_STORAGE_ENDPOINT}/transaction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ puts: serializedPuts, deletes, clearStores })
  });
}

async function fileStorageRequest(url, options = {}) {
  let response;
  try {
    response = await fetch(url, { cache: "no-store", ...options });
  } catch (error) {
    throw new Error("Файловое хранилище недоступно. Запусти или перезапусти приложение через .venv/bin/python server.py.", { cause: error });
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || `Файловое хранилище вернуло HTTP ${response.status}. Перезапусти server.py.`);
  }
  return result;
}

function snapshotHasRecords(snapshot) {
  return STORE_NAMES.some((name) => snapshot.stores[name].length > 0);
}

function requestDone(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", resolve);
    transaction.addEventListener("abort", () => reject(transaction.error));
    transaction.addEventListener("error", () => reject(transaction.error));
  });
}

async function serializeBinaryFields(record) {
  if (!(record?.blob instanceof Blob)) return record;
  return {
    ...record,
    blob: null,
    blobBase64: await blobToBase64(record.blob),
    blobType: record.blob.type
  };
}

async function deserializeBinaryFields(record) {
  if (!record?.blobBase64) return record;
  const { blobBase64, blobType, ...rest } = record;
  return { ...rest, blob: base64ToBlob(blobBase64, blobType) };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result.split(",")[1]));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64, type) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}
