const DB_NAME = "FrenchStudyDB";
const DB_VERSION = 1;

export const STORE_NAMES = [
  "kv",
  "vocabulary",
  "schedules",
  "reviewLogs",
  "exercises",
  "recordings"
];

let databasePromise;

export function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.addEventListener("upgradeneeded", () => {
        const database = request.result;
        for (const name of STORE_NAMES) {
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
  await runRequest(storeName, "readwrite", (store) => store.put(value));
  return value;
}

export async function deleteRecord(storeName, id) {
  await runRequest(storeName, "readwrite", (store) => store.delete(id));
}

export async function getValue(key, fallback = null) {
  const record = await getRecord("kv", key);
  return record ? record.value : fallback;
}

export async function setValue(key, value) {
  return putRecord("kv", { key, value });
}

export async function migrateLegacyProgress(defaultAppState) {
  const done = await getValue("legacyMigrationDone", false);
  if (done) {
    const saved = await getValue("appState", defaultAppState);
    const normalized = normalizeCompletionModel(saved, defaultAppState);
    if (normalized.completionModelVersion !== saved?.completionModelVersion) {
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
  if (saved.completionModelVersion === 1) {
    return {
      ...normalized,
      completedLessons: uniqueStrings(normalized.completedLessons),
      legacyCompletedLessons: uniqueStrings(normalized.legacyCompletedLessons)
    };
  }
  return {
    ...normalized,
    completionModelVersion: 1,
    legacyCompletedLessons: uniqueStrings([
      ...(Array.isArray(saved.legacyCompletedLessons) ? saved.legacyCompletedLessons : []),
      ...(Array.isArray(saved.completedLessons) ? saved.completedLessons : [])
    ]),
    completedLessons: []
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
  if (record.key === "appState") validateAppState(record.value);
  if (record.key === "settings") validateSettings(record.value);
  if (["legacyMigrationDone", "legacySchedulesMigrated"].includes(record.key) && typeof record.value !== "boolean") {
    throw new Error(`Настройка ${record.key} должна быть логическим значением.`);
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
  if (value.completionModelVersion != null && value.completionModelVersion !== 1) {
    throw new Error("appState.completionModelVersion должен быть равен 1.");
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

function validateSettings(value) {
  if (!isPlainObject(value)) throw new Error("settings должен быть объектом.");
  if (value.voiceURI != null && typeof value.voiceURI !== "string") throw new Error("settings.voiceURI должен быть строкой.");
  if (value.voiceRate != null && (!Number.isFinite(value.voiceRate) || value.voiceRate < 0.1 || value.voiceRate > 3)) {
    throw new Error("settings.voiceRate находится вне допустимого диапазона.");
  }
  if (value.newCardsPerDay != null && (!Number.isInteger(value.newCardsPerDay) || value.newCardsPerDay < 0 || value.newCardsPerDay > 1000)) {
    throw new Error("settings.newCardsPerDay должен быть целым числом от 0 до 1000.");
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
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAMES, "readwrite");
  for (const name of STORE_NAMES) transaction.objectStore(name).clear();
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
