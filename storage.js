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
  if (done) return getValue("appState", defaultAppState);

  let legacy = null;
  try {
    legacy = JSON.parse(localStorage.getItem("frenchStudyProgress") || "null");
  } catch {
    legacy = null;
  }

  const current = await getValue("appState", defaultAppState);
  const migrated = {
    ...defaultAppState,
    ...current,
    completedLessons: Array.isArray(legacy?.completedLessons)
      ? legacy.completedLessons
      : current.completedLessons,
    legacyCardProgress: legacy?.cards || current.legacyCardProgress || {},
    legacyRecordingMetadata: legacy?.recordings || current.legacyRecordingMetadata || {}
  };

  await setValue("appState", migrated);
  await setValue("legacyMigrationDone", true);
  return migrated;
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
  }
  return true;
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
