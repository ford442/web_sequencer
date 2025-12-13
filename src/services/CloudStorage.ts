// src/services/CloudStorage.ts

// Replace this with your actual Hugging Face Space URL
// Example: "https://your-username-space-name.hf.space"
const API_BASE_URL = "https://ford442-electribe-cloud.hf.space";

export interface CloudSongMeta {
    id: string;
    name: string;
    author: string;
    date: string;
    description?: string;
}

export interface CloudSongPayload {
    name: string;
    author: string;
    description: string;
    data: any; // The full JSON song data
}

export const CloudStorage = {
    async getSongs(): Promise<CloudSongMeta[]> {
        try {
            const res = await fetch(`${API_BASE_URL}/api/songs`);
            if (!res.ok) throw new Error("Failed to fetch songs");
            return await res.json();
        } catch (e) {
            console.error("CloudStorage: Fetch error", e);
            // Return mock data if API fails for testing UI
            return [
                { id: '1', name: 'Acid House Demo', author: 'Jules', date: '2023-12-12', description: 'Classic 303 vibes' },
                { id: '2', name: 'DnB Roller', author: 'Guest', date: '2023-12-13', description: 'Fast paced beats' }
            ];
        }
    },

    async getSongData(id: string): Promise<any> {
        const res = await fetch(`${API_BASE_URL}/api/songs/${id}`);
        if (!res.ok) throw new Error("Failed to fetch song data");
        return await res.json();
    },

    async uploadSong(payload: CloudSongPayload): Promise<{ success: boolean; id?: string; error?: string }> {
        try {
            const res = await fetch(`${API_BASE_URL}/api/upload`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const err = await res.text();
                throw new Error(err || res.statusText);
            }

            const data = await res.json();
            return { success: true, id: data.id };
        } catch (e: any) {
            console.error("CloudStorage: Upload error", e);
            return { success: false, error: e.message };
        }
    }
};
