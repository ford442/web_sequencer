export declare const PTHREAD_WORKER_STAMP_BANNER: string;
export declare function ensurePthreadWorkerStamp(options: {
  srcDir: string;
  stem: string;
  dest: string;
}): { action: 'copied' | 'stubbed', source: string | null };
