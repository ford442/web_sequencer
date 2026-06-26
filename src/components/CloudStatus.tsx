import React, { useEffect, useState } from 'react';
import { API_BASE_URL, CloudStatusManager } from '../services/CloudStorage';

type StatusState = 'SLEEPING' | 'WAKING' | 'ONLINE' | 'ERROR' | 'UPLOADING' | 'COMPLETE';

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const CloudStatus: React.FC = React.memo(() => {
    const [connectionStatus, setConnectionStatus] = useState<StatusState>('SLEEPING');
    const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'complete' | 'error'>('idle');

    const checkHealth = async () => {
        // If we are uploading, don't spam pings
        if (uploadStatus === 'uploading') return;

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);

            const res = await fetch(API_BASE_URL, { signal: controller.signal });
            clearTimeout(timeout);

            if (res.ok) {
                setConnectionStatus('ONLINE');
            } else {
                setConnectionStatus('ERROR');
            }
        } catch {
            setConnectionStatus('SLEEPING');
        }
    };

    useEffect(() => {
        // Subscribe to upload events
        const unsubscribe = CloudStatusManager.subscribe((status) => {
            setUploadStatus(status);
            if (status === 'uploading') setConnectionStatus('UPLOADING');
            if (status === 'complete') setConnectionStatus('COMPLETE');
            if (status === 'error') setConnectionStatus('ERROR');
            if (status === 'idle') checkHealth(); // Re-check connection when idle
        });

        // Initial Check
        checkHealth();
        // Poll every 30s
        const interval = setInterval(checkHealth, 30000);
        return () => {
            clearInterval(interval);
            unsubscribe();
        };
    }, []);

    const handleWake = () => {
        setConnectionStatus('WAKING');
        checkHealth();
    };

    // Determine what to show
    // Priority: Uploading/Complete > Waking > Error > Sleeping > Online (Passive)
    let content: React.ReactNode = null;

    if (uploadStatus === 'uploading') {
        content = (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-blue-900/20 border border-blue-800 rounded text-[10px] font-mono text-blue-400">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce"></div>
                UPLOADING...
            </div>
        );
    } else if (uploadStatus === 'complete') {
        content = (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-green-900/20 border border-green-800 rounded text-[10px] font-mono text-green-400">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                UPLOAD COMPLETE
            </div>
        );
    } else if (connectionStatus === 'WAKING') {
        content = (
             <div className="flex items-center gap-1.5 px-2 py-1 bg-cyan-900/20 border border-cyan-800 rounded text-[10px] font-mono text-cyan-400">
                 <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-ping"></div>
                 WAKING UP...
             </div>
         );
    } else if (connectionStatus === 'SLEEPING' || connectionStatus === 'ERROR') {
        content = (
<<<<<<< HEAD
            <button
=======
            <button type="button"
>>>>>>> origin/main
                onClick={handleWake}
                className="flex items-center gap-1.5 px-2 py-1 bg-yellow-900/20 border border-yellow-800 rounded text-[10px] font-mono text-yellow-400 hover:bg-yellow-900/40 transition-colors"
                aria-label="Wake up cloud storage"
                title="Click to wake up cloud storage"
            >
                <div className="w-1.5 h-1.5 rounded-full bg-yellow-600"></div>
                {connectionStatus === 'SLEEPING' ? 'CLOUD ASLEEP' : 'CLOUD OFFLINE'}
            </button>
        );
    } else if (connectionStatus === 'ONLINE') {
        content = (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-green-900/20 border border-green-800 rounded text-[10px] font-mono text-green-400">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
                CLOUD READY
            </div>
        );
    }

    return (
        <div role="status" aria-live="polite" aria-atomic="true" className="mr-2 min-h-[24px]">
            {content}
        </div>
    );
});
