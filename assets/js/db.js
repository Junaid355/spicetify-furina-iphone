// assets/js/db.js — IndexedDB storage engine for Spicetify Furina iPhone
const DB_NAME = 'SpicetifyFurinaDB';
const DB_VERSION = 1;

let dbInstance = null;

export async function openDB() {
  if (dbInstance) return dbInstance;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      // Tracks store
      if (!db.objectStoreNames.contains('tracks')) {
        const trackStore = db.createObjectStore('tracks', { keyPath: 'id' });
        trackStore.createIndex('isDownloaded', 'isDownloaded', { unique: false });
        trackStore.createIndex('playlistId', 'playlistId', { unique: false });
      }

      // Playlists store
      if (!db.objectStoreNames.contains('playlists')) {
        db.createObjectStore('playlists', { keyPath: 'id' });
      }

      // Offline Audio Blobs store (separated for performance)
      if (!db.objectStoreNames.contains('offline_audio')) {
        db.createObjectStore('offline_audio', { keyPath: 'id' });
      }

      // Extensions store
      if (!db.objectStoreNames.contains('extensions')) {
        db.createObjectStore('extensions', { keyPath: 'id' });
      }

      // Themes store
      if (!db.objectStoreNames.contains('themes')) {
        db.createObjectStore('themes', { keyPath: 'id' });
      }

      // App Settings store
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    req.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };

    req.onerror = (e) => reject(e.target.error);
  });
}

// Helper generic store access
async function tx(storeName, mode, callback) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let result;
    try {
      result = callback(store);
    } catch (err) {
      reject(err);
    }
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = (e) => reject(e.target.error);
  });
}

// Tracks API
export async function getAllTracks() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('tracks', 'readonly').objectStore('tracks').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getTrack(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('tracks', 'readonly').objectStore('tracks').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveTrack(track) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('tracks', 'readwrite').objectStore('tracks').put(track);
    req.onsuccess = () => resolve(track);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteTrack(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(['tracks', 'offline_audio'], 'readwrite');
    t.objectStore('tracks').delete(id);
    t.objectStore('offline_audio').delete(id);
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error);
  });
}

// Offline Audio Blob Store
export async function saveOfflineAudio(id, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(['tracks', 'offline_audio'], 'readwrite');
    t.objectStore('offline_audio').put({ id, blob, cachedAt: Date.now() });
    
    // Update track status
    const trackReq = t.objectStore('tracks').get(id);
    trackReq.onsuccess = () => {
      if (trackReq.result) {
        const track = trackReq.result;
        track.isDownloaded = true;
        track.downloadedAt = Date.now();
        t.objectStore('tracks').put(track);
      }
    };
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error);
  });
}

export async function getOfflineAudio(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('offline_audio', 'readonly').objectStore('offline_audio').get(id);
    req.onsuccess = () => resolve(req.result ? req.result.blob : null);
    req.onerror = () => reject(req.error);
  });
}

export async function removeOfflineAudio(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(['tracks', 'offline_audio'], 'readwrite');
    t.objectStore('offline_audio').delete(id);
    const trackReq = t.objectStore('tracks').get(id);
    trackReq.onsuccess = () => {
      if (trackReq.result) {
        const track = trackReq.result;
        track.isDownloaded = false;
        t.objectStore('tracks').put(track);
      }
    };
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error);
  });
}

// Playlists API
export async function getAllPlaylists() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('playlists', 'readonly').objectStore('playlists').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getPlaylist(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('playlists', 'readonly').objectStore('playlists').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function savePlaylist(playlist) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('playlists', 'readwrite').objectStore('playlists').put(playlist);
    req.onsuccess = () => resolve(playlist);
    req.onerror = () => reject(req.error);
  });
}

export async function deletePlaylist(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('playlists', 'readwrite').objectStore('playlists').delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

// Settings API
export async function getSetting(key, defaultValue = null) {
  const db = await openDB();
  return new Promise((resolve) => {
    const req = db.transaction('settings', 'readonly').objectStore('settings').get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : defaultValue);
    req.onerror = () => resolve(defaultValue);
  });
}

export async function setSetting(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('settings', 'readwrite').objectStore('settings').put({ key, value });
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

// Extensions API
export async function getAllExtensions() {
  const db = await openDB();
  return new Promise((resolve) => {
    const req = db.transaction('extensions', 'readonly').objectStore('extensions').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

export async function saveExtension(ext) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('extensions', 'readwrite').objectStore('extensions').put(ext);
    req.onsuccess = () => resolve(ext);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteExtension(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('extensions', 'readwrite').objectStore('extensions').delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

// Themes API
export async function getAllCustomThemes() {
  const db = await openDB();
  return new Promise((resolve) => {
    const req = db.transaction('themes', 'readonly').objectStore('themes').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

export async function saveCustomTheme(theme) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('themes', 'readwrite').objectStore('themes').put(theme);
    req.onsuccess = () => resolve(theme);
    req.onerror = () => reject(req.error);
  });
}
