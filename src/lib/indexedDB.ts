const DB_NAME = 'CloudStockCache';
const STORE_NAME = 'appData';
const DB_VERSION = 1;
const IDB_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported'));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Saves data to device storage (IndexedDB).
 * Fails silently to ensure app stability.
 */
export async function saveToIndexedDB(key: string, data: any[]): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({ data, savedAt: Date.now() }, key);
    
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (e) {
    console.warn('IndexedDB save failed:', e);
  }
}

/**
 * Loads data from device storage.
 * Returns null if expired (30 mins) or not found.
 */
export async function loadFromIndexedDB(key: string): Promise<any[] | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);
    
    return new Promise((resolve) => {
      request.onsuccess = () => {
        const result = request.result;
        if (!result) return resolve(null);
        
        const now = Date.now();
        if (now - result.savedAt > IDB_CACHE_TTL) {
          resolve(null);
        } else {
          resolve(result.data);
        }
      };
      request.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

/**
 * Wipes all stored data from IndexedDB.
 */
export async function clearIndexedDB(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
  } catch (e) {
    // Silently fail
  }
}
