// idb.js — IndexedDB helper for local-only file storage
// Stores files by (userId, jobId, type): resume | cover | portfolio

const DB_NAME = "hiredpath_db_v1";
const DB_VERSION = 1;
const STORE = "files";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      const store = db.createObjectStore(STORE, { keyPath: "key" });
      store.createIndex("byJob", "jobKey");   // userId|jobId
      store.createIndex("byUser", "userId");
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function makeKey({ userId, jobId, type }) {
  return `${userId}|${jobId}|${type}`;
}
function makeJobKey({ userId, jobId }) {
  return `${userId}|${jobId}`;
}

export async function putFile({ userId, jobId, type, file }) {
  const db = await openDB();
  const rec = {
    key: makeKey({ userId, jobId, type }),
    jobKey: makeJobKey({ userId, jobId }),
    userId,
    jobId,
    type,
    filename: file.name,
    mime: file.type || "application/octet-stream",
    uploadedAt: Date.now(),
    blob: file
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(rec);
    tx.oncomplete = () => resolve(rec);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getFile({ userId, jobId, type }) {
  const db = await openDB();
  const key = makeKey({ userId, jobId, type });

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteFile({ userId, jobId, type }) {
  const db = await openDB();
  const key = makeKey({ userId, jobId, type });

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

// ✅ what you mentioned:
export async function listFilesForJob({ userId, jobId }) {
  const db = await openDB();
  const jobKey = makeJobKey({ userId, jobId });

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const idx = tx.objectStore(STORE).index("byJob");
    const req = idx.getAll(jobKey);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteFilesForJob({ userId, jobId }) {
  const files = await listFilesForJob({ userId, jobId });
  await Promise.all(files.map(f => deleteFile({ userId, jobId, type: f.type })));
}

export async function listFilesForUser({ userId }) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const idx = tx.objectStore(STORE).index("byUser");
    const req = idx.getAll(userId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteFilesForUser({ userId }) {
  const db = await openDB();
  const all = await listFilesForUser({ userId });

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    all.forEach(rec => store.delete(rec.key));
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}