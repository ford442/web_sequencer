// src/components/CloudLibrary.tsx
import React, { useEffect, useState } from 'react';
import { CloudStorage } from '../services/CloudStorage';
import type { CloudSongMeta, CloudItemType } from '../services/CloudStorage';

interface CloudLibraryProps {
    isOpen: boolean;
    onClose: () => void;
    onLoadData: (data: any, type: CloudItemType) => void;
    // Data getters for different types
    getSongData: () => any;
    getBankData: () => any;
    getPatternData: () => any;
}

export const CloudLibrary: React.FC<CloudLibraryProps> = ({ 
    isOpen, onClose, onLoadData, getSongData, getBankData, getPatternData 
}) => {
    const [activeTab, setActiveTab] = useState<'browse' | 'upload'>('browse');
    const [filterType, setFilterType] = useState<CloudItemType | 'all'>('all');
    const [songs, setSongs] = useState<CloudSongMeta[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    // Upload Form State
    const [uploadForm, setUploadForm] = useState({ name: '', author: '', description: '' });
    const [uploadType, setUploadType] = useState<CloudItemType>('song');
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

    const handleLoadClick = async (item: CloudSongMeta) => {
        setIsLoading(true);
        try {
            const data = await CloudStorage.getSongData(item.id);
            // Pass both data and type so App.tsx knows how to handle it
            onLoadData(data, item.type);
            onClose();
        } catch (e) {
            alert("Failed to load data");
        } finally {
            setIsLoading(false);
        }
    };

    const filteredSongs = songs.filter(s => filterType === 'all' || s.type === filterType);

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
                        UPLOAD
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 min-h-[400px]">
                    {activeTab === 'browse' ? (
                        <div className="space-y-4">
                            {/* Filter Bar */}
                            <div className="flex justify-between items-center mb-4">
                                <div className="flex gap-2">
                                    {['all', 'song', 'bank', 'pattern'].map((t) => (
                                        <button
                                            key={t}
                                            onClick={() => setFilterType(t as any)}
                                            className={`px-3 py-1 rounded text-xs font-bold uppercase transition-all ${filterType === t ? 'bg-cyan-600 text-white' : 'bg-gray-800 text-gray-500 hover:bg-gray-700'}`}
                                        >
                                            {t}
                                        </button>
                                    ))}
                                </div>
                                <button onClick={loadLibrary} className="text-xs text-gray-400 hover:text-white">↻ Refresh</button>
                            </div>

                            {isLoading ? (
                                <div className="text-center py-10 text-gray-500 font-mono animate-pulse">Loading from Cloud...</div>
                            ) : songs.length === 0 ? (
                                <div className="text-center py-10 text-gray-600 font-mono">No songs found. Be the first to upload!</div>
                            ) : (
                                <div className="grid gap-3">
                                    {filteredSongs.map(item => (
                                        <div key={item.id} className="bg-gray-800/40 border border-gray-700 hover:border-cyan-500/50 rounded-lg p-3 flex justify-between items-center transition-all group">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded text-black font-bold uppercase ${
                                                        item.type === 'song' ? 'bg-blue-400' : 
                                                        item.type === 'bank' ? 'bg-purple-400' : 'bg-green-400'
                                                    }`}>
                                                        {item.type}
                                                    </span>
                                                    <span className="font-bold text-gray-200">{item.name}</span>
                                                </div>
                                                <div className="text-xs text-gray-500 font-mono mt-1 ml-1">
                                                    by <span className="text-cyan-400">{item.author}</span> • {item.date}
                                                </div>
                                                {item.description && <div className="text-xs text-gray-600 mt-1 ml-1 italic">{item.description}</div>}
                                            </div>
                                            <button 
                                                onClick={() => handleLoadClick(item)}
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
                                
                                {/* Type Selection */}
                                <div className="bg-gray-800/50 p-3 rounded-lg border border-gray-700">
                                    <label className="block text-xs text-gray-400 font-mono mb-2 uppercase">What are you saving?</label>
                                    <div className="flex gap-4">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input type="radio" name="utype" checked={uploadType === 'song'} onChange={() => setUploadType('song')} className="accent-pink-500"/>
                                            <span className="text-sm text-gray-300">Full Song</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input type="radio" name="utype" checked={uploadType === 'bank'} onChange={() => setUploadType('bank')} className="accent-pink-500"/>
                                            <span className="text-sm text-gray-300">Pattern Bank</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input type="radio" name="utype" checked={uploadType === 'pattern'} onChange={() => setUploadType('pattern')} className="accent-pink-500"/>
                                            <span className="text-sm text-gray-300">Current Pattern</span>
                                        </label>
                                    </div>
                                    <div className="text-[10px] text-gray-500 mt-2 italic">
                                        {uploadType === 'song' && "Saves arrangement, patterns, and knob settings."}
                                        {uploadType === 'bank' && "Saves all 8 pattern slots for all tracks."}
                                        {uploadType === 'pattern' && "Saves only the currently active pattern."}
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs text-gray-400 font-mono mb-1">Name</label>
                                    <input
                                        type="text"
                                        required
                                        maxLength={40}
                                        value={uploadForm.name}
                                        onChange={e => setUploadForm({...uploadForm, name: e.target.value})}
                                        className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white focus:border-pink-500 focus:outline-none transition-colors"
                                        placeholder={uploadType === 'song' ? "My Song" : "My Pattern"}
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
                                         `UPLOAD ${uploadType.toUpperCase()}`}
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
