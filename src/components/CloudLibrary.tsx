// src/components/CloudLibrary.tsx
import React, { useEffect, useState } from 'react';
import { CloudStorage } from '../services/CloudStorage';
import type { CloudSongMeta } from '../services/CloudStorage';

interface CloudLibraryProps {
    isOpen: boolean;
    onClose: () => void;
    onLoadSong: (data: any) => void;
    getSongDataForUpload: () => any; // Function to get current app state
}

export const CloudLibrary: React.FC<CloudLibraryProps> = ({ isOpen, onClose, onLoadSong, getSongDataForUpload }) => {
    const [activeTab, setActiveTab] = useState<'browse' | 'upload'>('browse');
    const [songs, setSongs] = useState<CloudSongMeta[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    // Upload Form State
    const [uploadForm, setUploadForm] = useState({ name: '', author: '', description: '' });
    const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');

    useEffect(() => {
        if (isOpen && activeTab === 'browse') {
            loadLibrary();
        }
    }, [isOpen, activeTab]);

    const loadLibrary = async () => {
        setIsLoading(true);
        const list = await CloudStorage.getSongs();
        setSongs(list);
        setIsLoading(false);
    };

    const handleLoadClick = async (id: string) => {
        setIsLoading(true);
        try {
            const data = await CloudStorage.getSongData(id);
            onLoadSong(data);
            onClose();
        } catch (e) {
            alert("Failed to load song data");
        } finally {
            setIsLoading(false);
        }
    };

    const handleUpload = async (e: React.FormEvent) => {
        e.preventDefault();
        setUploadStatus('uploading');

        try {
            const songData = getSongDataForUpload();
            const result = await CloudStorage.uploadSong({
                name: uploadForm.name || "Untitled",
                author: uploadForm.author || "Anonymous",
                description: uploadForm.description,
                data: songData
            });

            if (result.success) {
                setUploadStatus('success');
                setTimeout(() => {
                    setUploadStatus('idle');
                    setActiveTab('browse');
                }, 1500);
            } else {
                setUploadStatus('error');
            }
        } catch (e) {
            setUploadStatus('error');
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-2xl bg-[#0f1215] border border-cyan-900/50 rounded-xl shadow-[0_0_50px_rgba(6,182,212,0.2)] overflow-hidden flex flex-col max-h-[80vh]">

                {/* Header Tabs */}
                <div className="flex border-b border-gray-800 bg-gray-900/50">
                    <button
                        onClick={() => setActiveTab('browse')}
                        className={`flex-1 py-4 font-orbitron font-bold text-sm tracking-widest transition-colors ${activeTab === 'browse' ? 'text-cyan-400 bg-gray-800/50' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                        CLOUD LIBRARY
                    </button>
                    <button
                        onClick={() => setActiveTab('upload')}
                        className={`flex-1 py-4 font-orbitron font-bold text-sm tracking-widest transition-colors ${activeTab === 'upload' ? 'text-pink-400 bg-gray-800/50' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                        UPLOAD CURRENT
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 min-h-[400px]">
                    {activeTab === 'browse' ? (
                        <div className="space-y-4">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-cyan-500 font-mono text-xs uppercase">Community Patterns</h3>
                                <button onClick={loadLibrary} className="text-xs text-gray-400 hover:text-white">↻ Refresh</button>
                            </div>

                            {isLoading ? (
                                <div className="text-center py-10 text-gray-500 font-mono animate-pulse">Loading from Cloud...</div>
                            ) : songs.length === 0 ? (
                                <div className="text-center py-10 text-gray-600 font-mono">No songs found. Be the first to upload!</div>
                            ) : (
                                <div className="grid gap-3">
                                    {songs.map(song => (
                                        <div key={song.id} className="bg-gray-800/40 border border-gray-700 hover:border-cyan-500/50 rounded-lg p-3 flex justify-between items-center transition-all group">
                                            <div>
                                                <div className="font-bold text-gray-200">{song.name}</div>
                                                <div className="text-xs text-gray-500 font-mono mt-1">
                                                    by <span className="text-cyan-400">{song.author}</span> • {song.date}
                                                </div>
                                                {song.description && <div className="text-xs text-gray-600 mt-1 italic">{song.description}</div>}
                                            </div>
                                            <button
                                                onClick={() => handleLoadClick(song.id)}
                                                className="bg-cyan-900/30 text-cyan-400 border border-cyan-800 px-3 py-1.5 rounded text-xs font-bold font-orbitron hover:bg-cyan-500 hover:text-black transition-all"
                                            >
                                                LOAD
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="max-w-md mx-auto">
                            <h3 className="text-pink-500 font-mono text-xs uppercase mb-6 text-center">Share your creation</h3>
                            <form onSubmit={handleUpload} className="space-y-4">
                                <div>
                                    <label className="block text-xs text-gray-400 font-mono mb-1">Song Name</label>
                                    <input
                                        type="text"
                                        required
                                        maxLength={40}
                                        value={uploadForm.name}
                                        onChange={e => setUploadForm({...uploadForm, name: e.target.value})}
                                        className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white focus:border-pink-500 focus:outline-none transition-colors"
                                        placeholder="My Awesome Track"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-400 font-mono mb-1">Author / Artist</label>
                                    <input
                                        type="text"
                                        required
                                        maxLength={20}
                                        value={uploadForm.author}
                                        onChange={e => setUploadForm({...uploadForm, author: e.target.value})}
                                        className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white focus:border-pink-500 focus:outline-none transition-colors"
                                        placeholder="Your Name"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-400 font-mono mb-1">Description (Optional)</label>
                                    <textarea
                                        maxLength={100}
                                        value={uploadForm.description}
                                        onChange={e => setUploadForm({...uploadForm, description: e.target.value})}
                                        className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white focus:border-pink-500 focus:outline-none transition-colors h-20 resize-none"
                                        placeholder="Style, bpm, mood..."
                                    />
                                </div>

                                <div className="pt-4">
                                    <button
                                        type="submit"
                                        disabled={uploadStatus === 'uploading' || uploadStatus === 'success'}
                                        className={`w-full py-3 rounded font-orbitron font-bold text-sm tracking-widest transition-all
                                            ${uploadStatus === 'success' ? 'bg-green-600 text-white' :
                                              uploadStatus === 'error' ? 'bg-red-600 text-white' :
                                              'bg-pink-700 text-white hover:bg-pink-600 border border-pink-500 shadow-[0_0_15px_rgba(236,72,153,0.3)]'}
                                        `}
                                    >
                                        {uploadStatus === 'uploading' ? 'UPLOADING...' :
                                         uploadStatus === 'success' ? 'UPLOAD COMPLETE!' :
                                         uploadStatus === 'error' ? 'FAILED - TRY AGAIN' :
                                         'UPLOAD TO CLOUD'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="border-t border-gray-800 p-4 bg-gray-900/50 flex justify-end">
                    <button onClick={onClose} className="text-gray-400 text-xs font-mono hover:text-white px-4">CLOSE</button>
                </div>
            </div>
        </div>
    );
};
