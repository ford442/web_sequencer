// src/services/CloudStorage.ts

// src/services/CloudStorage.ts

// Replace with your actual Space URL
const API_BASE_URL = "https://ford442-storage-manager.hf.space"; 

export type CloudItemType = 'song' | 'pattern' | 'bank' | 'sample';

export interface CloudSongMeta {
    id: string;
    name: string;
    author: string;
    date: string;
    type: CloudItemType;
    description?: string;
    filename?: string;
}

export interface CloudSongPayload {
    name: string;
    author: string;
    description: string;
    type: CloudItemType; // Added type field
    data: any; 
}

export const CloudStorage = {
    async getSongs(): Promise<CloudSongMeta[]> {
        try {
            const res = await fetch(`${API_BASE_URL}/api/songs`);
            if (!res.ok) throw new Error("Failed to fetch library");
            return await res.json();
        } catch (e) {
            console.error("CloudStorage: Fetch error", e);
            return [];
        }
    },

    async getSongData(id: string): Promise<any> {
        const res = await fetch(`${API_BASE_URL}/api/songs/${id}`);
        if (!res.ok) throw new Error("Failed to fetch data");
        return await res.json();
    },

    async uploadItem(payload: CloudSongPayload): Promise<{ success: boolean; id?: string; error?: string }> {
        const TIMEOUT_MS = 15000;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

        try {
            const res = await fetch(`${API_BASE_URL}/api/songs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (!res.ok) {
                const err = await res.text();
                throw new Error(err || res.statusText);
            }

            const data = await res.json();
            return { success: true, id: data.id };
        } catch (e: any) {
            clearTimeout(timeout);
            if (e && e.name === 'AbortError') {
                console.error("CloudStorage: Upload aborted (timeout)");
                return { success: false, error: 'Request timed out' };
            }
            console.error("CloudStorage: Upload error", e);
            return { success: false, error: e?.message || String(e) };
        }
    }
};
