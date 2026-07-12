import { DB_CONFIG } from './constants';
import type { CloudSongPayload, PendingUpload, StorageErrorInfo } from './types';

class IndexedDBManager {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_CONFIG.NAME, DB_CONFIG.VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(DB_CONFIG.STORES.PENDING_UPLOADS)) {
          const store = db.createObjectStore(DB_CONFIG.STORES.PENDING_UPLOADS, { keyPath: 'id' });
          store.createIndex('attempts', 'attempts', { unique: false });
          store.createIndex('lastAttempt', 'lastAttempt', { unique: false });
        }

        if (!db.objectStoreNames.contains(DB_CONFIG.STORES.SONG_ERRORS)) {
          db.createObjectStore(DB_CONFIG.STORES.SONG_ERRORS, { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains(DB_CONFIG.STORES.VERSION_HISTORY)) {
          const store = db.createObjectStore(DB_CONFIG.STORES.VERSION_HISTORY, { keyPath: 'id' });
          store.createIndex('songId', 'songId', { unique: false });
        }
      };
    });
  }

  async addPendingUpload(payload: CloudSongPayload): Promise<void> {
    await this.ensureDB();
    const pending: PendingUpload = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      payload,
      attempts: 0,
      lastAttempt: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([DB_CONFIG.STORES.PENDING_UPLOADS], 'readwrite');
      const store = tx.objectStore(DB_CONFIG.STORES.PENDING_UPLOADS);
      const request = store.put(pending);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getPendingUploads(): Promise<PendingUpload[]> {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([DB_CONFIG.STORES.PENDING_UPLOADS], 'readonly');
      const store = tx.objectStore(DB_CONFIG.STORES.PENDING_UPLOADS);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async removePendingUpload(id: string): Promise<void> {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([DB_CONFIG.STORES.PENDING_UPLOADS], 'readwrite');
      const store = tx.objectStore(DB_CONFIG.STORES.PENDING_UPLOADS);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async updatePendingUpload(pending: PendingUpload): Promise<void> {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([DB_CONFIG.STORES.PENDING_UPLOADS], 'readwrite');
      const store = tx.objectStore(DB_CONFIG.STORES.PENDING_UPLOADS);
      const request = store.put(pending);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async storeSongError(songId: string, error: StorageErrorInfo): Promise<void> {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([DB_CONFIG.STORES.SONG_ERRORS], 'readwrite');
      const store = tx.objectStore(DB_CONFIG.STORES.SONG_ERRORS);
      const request = store.put({ id: songId, error, timestamp: new Date().toISOString() });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getSongError(songId: string): Promise<StorageErrorInfo | null> {
    await this.ensureDB();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([DB_CONFIG.STORES.SONG_ERRORS], 'readonly');
      const store = tx.objectStore(DB_CONFIG.STORES.SONG_ERRORS);
      const request = store.get(songId);
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.error : null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async ensureDB(): Promise<void> {
    if (!this.db) {
      await this.init();
    }
  }
}

export const dbManager = new IndexedDBManager();
