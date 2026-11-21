// Everything is stored only in this browser on this device.

const PREFIX = 'novel-checker:';

export const prefs = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  }
};

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open('novel-checker', 2);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains('reports')) d.createObjectStore('reports', { keyPath: 'id' });
          // The book's text (and the original .docx), kept apart so the history list stays quick to load.
          if (!d.objectStoreNames.contains('texts')) d.createObjectStore('texts', { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  return dbPromise;
}

function tx(mode, fn, storeName = 'reports') {
  return db().then((d) => new Promise((resolve) => {
    if (!d) return resolve(null);
    try {
      const t = d.transaction(storeName, mode);
      const store = t.objectStore(storeName);
      const req = fn(store);
      t.oncomplete = () => resolve(req ? req.result : true);
      t.onerror = () => resolve(null);
    } catch { resolve(null); }
  }));
}

export const history = {
  save(report) { return tx('readwrite', (s) => s.put(report)); },
  async remove(id) { await tx('readwrite', (s) => s.delete(id), 'texts'); return tx('readwrite', (s) => s.delete(id)); },
  async clear() { await tx('readwrite', (s) => s.clear(), 'texts'); return tx('readwrite', (s) => s.clear()); },
  saveText(text) { return tx('readwrite', (s) => s.put(text), 'texts'); },
  getText(id) { return tx('readonly', (s) => s.get(id), 'texts'); },
  get(id) { return tx('readonly', (s) => s.get(id)); },
  async list() {
    const all = await tx('readonly', (s) => s.getAll());
    return (all || []).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }
};
