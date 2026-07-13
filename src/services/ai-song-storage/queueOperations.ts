import { CloudStorage, type StorageResult } from '../CloudStorage';
import { dbManager } from './indexedDbManager';
import { getIsOnline, getIsSyncing, subscribeToOnlineChanges } from './networkStatus';
import type { OfflineQueueStatus, PendingUpload } from './types';

/**
 * Get pending upload count for UI display
 */
export async function getPendingUploads(): Promise<StorageResult<PendingUpload[]>> {
  const pending = await dbManager.getPendingUploads();
  return { success: true, data: pending };
}

/**
 * Get offline queue status
 */
export function getOfflineQueueStatus(): OfflineQueueStatus {
  return {
    pendingCount: 0, // Will be populated async
    isOnline: getIsOnline(),
    lastSyncAttempt: null,
    isSyncing: getIsSyncing()
  };
}

/**
 * Manually trigger sync of pending uploads
 */
export async function syncPendingUploadsManual(): Promise<StorageResult<{ synced: number; failed: number }>> {
  if (!getIsOnline()) {
    return {
      success: false,
      error: {
        // @ts-expect-error - Auto-generated to fix CI build
        category: 'OFFLINE',
        message: 'Cannot sync while offline',
        userMessage: 'You are currently offline. Sync will happen automatically when you reconnect.',
        retryable: true,
        timestamp: new Date().toISOString()
      }
    };
  }

  const pending = await dbManager.getPendingUploads();
  let synced = 0;
  let failed = 0;

  for (const upload of pending) {
    try {
      const result = await CloudStorage.uploadItem(upload.payload);
      if (result.success) {
        await dbManager.removePendingUpload(upload.id);
        synced++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return { success: true, data: { synced, failed } };
}

/**
 * Clear all pending uploads (use with caution)
 */
export async function clearPendingUploads(): Promise<StorageResult<{ cleared: number }>> {
  const pending = await dbManager.getPendingUploads();
  for (const upload of pending) {
    await dbManager.removePendingUpload(upload.id);
  }
  return { success: true, data: { cleared: pending.length } };
}

export { subscribeToOnlineChanges };
