import { CloudStorage } from '../CloudStorage';
import { classifyAndEnhanceError } from './errorHandling';
import { dbManager } from './indexedDbManager';
import { log } from './logging';

let isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
const onlineListeners: ((online: boolean) => void)[] = [];
let isSyncing = false;

async function syncPendingUploadsInternal(): Promise<void> {
  if (isSyncing || !isOnline) return;

  isSyncing = true;
  log('Starting sync of pending uploads');

  try {
    const pending = await dbManager.getPendingUploads();
    log(`Found ${pending.length} pending uploads`);

    for (const upload of pending) {
      try {
        const result = await CloudStorage.uploadItem(upload.payload);

        if (result.success) {
          await dbManager.removePendingUpload(upload.id);
          log(`Synced pending upload: ${upload.id}`);
        } else {
          upload.attempts++;
          upload.lastAttempt = new Date().toISOString();
          upload.error = result.error ? classifyAndEnhanceError(result.error) : undefined;
          await dbManager.updatePendingUpload(upload);
        }
      } catch (e) {
        upload.attempts++;
        upload.lastAttempt = new Date().toISOString();
        upload.error = classifyAndEnhanceError(e);
        await dbManager.updatePendingUpload(upload);
      }
    }
  } finally {
    isSyncing = false;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    isOnline = true;
    onlineListeners.forEach(l => l(true));
    syncPendingUploadsInternal();
  });

  window.addEventListener('offline', () => {
    isOnline = false;
    onlineListeners.forEach(l => l(false));
  });
}

export function subscribeToOnlineChanges(callback: (online: boolean) => void): () => void {
  onlineListeners.push(callback);
  return () => {
    const idx = onlineListeners.indexOf(callback);
    if (idx > -1) onlineListeners.splice(idx, 1);
  };
}

export function getIsOnline(): boolean {
  return isOnline;
}

export function getIsSyncing(): boolean {
  return isSyncing;
}

export { syncPendingUploadsInternal as syncPendingUploads };
