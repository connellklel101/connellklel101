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
        const req = indexedDB.open('novel-checker', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('reports', { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  return dbPromise;
}

function tx(mode, fn) {
  return db().then((d) => new Promise((resolve) => {
    if (!d) return resolve(null);
    try {
      const t = d.transaction('reports', mode);
      const store = t.objectStore('reports');
      const req = fn(store);
      t.oncomplete = () => resolve(req ? req.result : true);
      t.onerror = () => resolve(null);
    } catch { resolve(null); }
  }));
}

export const history = {
  save(report) { return tx('readwrite', (s) => s.put(report)); },
  remove(id) { return tx('readwrite', (s) => s.delete(id)); },
  clear() { return tx('readwrite', (s) => s.clear()); },
  get(id) { return tx('readonly', (s) => s.get(id)); },
  async list() {
    const all = await tx('readonly', (s) => s.getAll());
    return (all || []).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }
};
