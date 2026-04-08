// src/components/CloudLibrary.tsx
import React, { useEffect, useState } from 'react';
import { CloudStorage } from '../services/CloudStorage';
import { useFocusTrap } from '../hooks/useFocusTrap';
import type { CloudSongMeta, CloudItemType } from '../services/CloudStorage';

interface CloudLibraryProps {
    isOpen: boolean;
    onClose: () => void;
    onLoadData: (data: any, type: CloudItemType) => void;
    onShowToast: (msg: string, type: 'success' | 'error') => void;
    // Data getters for different types
    getSongData: () => any;
    getBankData: () => any;
    getPatternData: () => any;
}

const TABS = [
    {
        id: 'browse',
        label: 'CLOUD LIBRARY',
        activeClass: 'text-cyan-400 bg-gray-800/50 border-b-2 border-cyan-400',
        focusClass: 'focus-visible:ring-cyan-500'
    },
    {
        id: 'upload',
        label: 'UPLOAD',
        activeClass: 'text-pink-400 bg-gray-800/50 border-b-2 border-pink-400',
        focusClass: 'focus-visible:ring-pink-500'
    }
] as const;

const SkeletonRow = () => (
    <div className="bg-gray-800/20 border border-gray-800 rounded-lg p-3 flex justify-between items-center animate-pulse" aria-hidden="true">
        <div className="w-full">
            <div className="flex items-center gap-2 mb-2">
                <div className="w-10 h-4 bg-gray-700 rounded" />
                <div className="w-32 h-4 bg-gray-700 rounded" />
            </div>
            <div className="flex gap-2 mb-1">
                <div className="w-24 h-3 bg-gray-700/50 rounded" />
                <div className="w-16 h-3 bg-gray-700/50 rounded" />
            </div>
            <div className="w-48 h-3 bg-gray-700/30 rounded" />
        </div>
        <div className="w-16 h-8 bg-gray-700/50 rounded" />
    </div>
);

export const CloudLibrary: React.FC<CloudLibraryProps> = ({ 
    isOpen, onClose, onLoadData, onShowToast, getSongData, getBankData, getPatternData
}) => {
    const [activeTab, setActiveTab] = useState<'browse' | 'upload'>('browse');
    const [filterType, setFilterType] = useState<CloudItemType | 'all'>('all');
    const [songs, setSongs] = useState<CloudSongMeta[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    // Upload Form State
    const [uploadForm, setUploadForm] = useState({ name: '', author: '', description: '' });
    const [uploadType, setUploadType] = useState<CloudItemType>('song');
    const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'retrying' | 'success' | 'error'>('idle');
    const [errorMessage, setErrorMessage] = useState<string>("");

    useEffect(() => {
        if (isOpen && activeTab === 'browse') {
            loadLibrary();
        }
    }, [isOpen, activeTab]);

    const loadLibrary = async () => {
        setIsLoading(true);
        try {
            const result = await CloudStorage.getSongs(
                filterType === 'all' ? undefined : (filterType as CloudItemType)
            );
            // Backend returns raw array for listing (no StorageResult wrapper)
            setSongs(Array.isArray(result) ? result : []);
        } catch (err) {
            console.error('[CloudLibrary] Failed to load:', err);
            setSongs([]);
            onShowToast('Failed to load library', 'error');
        }
        setIsLoading(false);
    };

    const performUpload = async (retryCount = 0): Promise<void> => {
        try {
            let dataToUpload: any;
            if (uploadType === 'song') dataToUpload = getSongData();
            else if (uploadType === 'bank') dataToUpload = getBankData();
            else if (uploadType === 'pattern') dataToUpload = getPatternData();

            const result = await CloudStorage.uploadItem({
                name: uploadForm.name || 'Untitled',
                author: uploadForm.author || 'Anonymous',
                description: uploadForm.description,
                type: uploadType,
                data: dataToUpload
            });
            console.debug('CloudLibrary: upload result', result);

            if (result.success) {
                setUploadStatus('success');
                setTimeout(() => {
                    setUploadStatus('idle');
                    setActiveTab('browse');
                    loadLibrary();
                }, 1500);
            } else {
                // Retry Logic
                if (retryCount < 1) {
                    setUploadStatus('retrying');
                    setTimeout(() => performUpload(retryCount + 1), 1500);
                } else {
                    setUploadStatus('error');
                    // @ts-expect-error - Auto-generated to fix CI build
                    setErrorMessage(result.error || "Unknown Error");
                }
            }
        } catch (err: any) {
            console.error('CloudLibrary: upload failed', err);
            if (retryCount < 1) {
                setUploadStatus('retrying');
                setTimeout(() => performUpload(retryCount + 1), 1500);
            } else {
                setUploadStatus('error');
                setErrorMessage(err.message || "Network Error");
            }
        }
    };

    const handleUpload = async (e: React.FormEvent) => {
        e.preventDefault();
        console.debug('CloudLibrary: starting upload', uploadType);
        setUploadStatus('uploading');
        setErrorMessage("");
        await performUpload(0);
    };

    const handleLoadClick = async (item: CloudSongMeta) => {
        setIsLoading(true);
        try {
            const res = await CloudStorage.getSongData(item.id, item.type);
            // Some backends wrap the payload under a `data` key; prefer inner payload if present
            const payload = (res && typeof res === 'object' && 'data' in res) ? (res as any).data : res;
            // Pass both data and type so App.tsx knows how to handle it
            onLoadData(payload, item.type);
            onClose();
        } catch {
            onShowToast("Failed to load data", "error");
        } finally {
            setIsLoading(false);
        }
    };

    const handleTabKeyDown = (e: React.KeyboardEvent) => {
        const currentIndex = TABS.findIndex(t => t.id === activeTab);
        let nextIndex = currentIndex;

        switch (e.key) {
            case 'ArrowRight':
                nextIndex = (currentIndex + 1) % TABS.length;
                break;
            case 'ArrowLeft':
                nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
                break;
            case 'Home':
                nextIndex = 0;
                break;
            case 'End':
                nextIndex = TABS.length - 1;
                break;
            default:
                return;
        }

        e.preventDefault();
        const nextTab = TABS[nextIndex];
        setActiveTab(nextTab.id as any);
        setTimeout(() => document.getElementById(`tab-${nextTab.id}`)?.focus(), 0);
    };

    const filteredSongs = songs.filter(s => filterType === 'all' || s.type === filterType);

    const modalRef = useFocusTrap(isOpen, onClose);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div ref={modalRef} className="w-full max-w-2xl bg-[#0f1215] border border-cyan-900/50 rounded-xl shadow-[0_0_50px_rgba(6,182,212,0.2)] overflow-hidden flex flex-col max-h-[80vh]">

                {/* Header Tabs */}
                <div
                    className="flex border-b border-gray-800 bg-gray-900/50"
                    role="tablist"
                    aria-label="Cloud Library Sections"
                    onKeyDown={handleTabKeyDown}
                >
                    {TABS.map(tab => (
                        <button
                            key={tab.id}
                            id={`tab-${tab.id}`}
                            role="tab"
                            aria-selected={activeTab === tab.id}
                            aria-controls="cloud-library-panel"
                            tabIndex={activeTab === tab.id ? 0 : -1}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`flex-1 py-4 font-orbitron font-bold text-sm tracking-widest transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset ${tab.focusClass} ${
                                activeTab === tab.id
                                    ? tab.activeClass
                                    : 'text-gray-500 hover:text-gray-300'
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div
                    id="cloud-library-panel"
                    role="tabpanel"
                    aria-labelledby={`tab-${activeTab}`}
                    className="flex-1 overflow-y-auto p-6 min-h-[400px] focus:outline-none"
                    tabIndex={0}
                >
                    {activeTab === 'browse' ? (
                        <div className="space-y-4">
                            {/* Filter Bar */}
                            <div className="flex justify-between items-center mb-4">
                                <div className="flex gap-2">
                                    {['all', 'song', 'bank', 'pattern'].map((t) => (
                                        <button
                                            key={t}
                                            onClick={() => setFilterType(t as any)}
                                            className={`px-3 py-1 rounded text-xs font-bold uppercase transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${filterType === t ? 'bg-cyan-600 text-white' : 'bg-gray-800 text-gray-500 hover:bg-gray-700'}`}
                                            aria-pressed={filterType === t}
                                        >
                                            {t}
                                        </button>
                                    ))}
                                </div>
                                <button onClick={loadLibrary} aria-label="Refresh cloud library" className="text-xs text-gray-400 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 rounded px-1">↻ Refresh</button>
                            </div>

                            {isLoading ? (
                                <div role="status" className="space-y-3">
                                    <span className="sr-only">Loading songs from cloud...</span>
                                    {[1, 2, 3, 4, 5].map(i => <SkeletonRow key={i} />)}
                                </div>
                            ) : songs.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-12 text-center">
                                    <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mb-4 text-gray-600">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                                        </svg>
                                    </div>
                                    <h3 className="text-gray-300 font-bold mb-2">No items found</h3>
                                    <p className="text-gray-500 text-xs mb-6 max-w-[200px]">
                                        The library is empty. Be the first to share your creation with the world!
                                    </p>
                                    <button
                                        onClick={() => setActiveTab('upload')}
                                        className="bg-cyan-900/30 text-cyan-400 border border-cyan-800/50 hover:bg-cyan-900/50 px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center gap-2 group focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                                        aria-label="Upload your first creation"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 transition-transform group-hover:-translate-y-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                        </svg>
                                        Share Your Creation
                                    </button>
                                </div>
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
                                                className="bg-cyan-900/30 text-cyan-400 border border-cyan-800 px-3 py-1.5 rounded text-xs font-bold font-orbitron hover:bg-cyan-500 hover:text-black transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
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
                                <fieldset className="bg-gray-800/50 p-3 rounded-lg border border-gray-700">
                                    <legend className="block text-xs text-gray-400 font-mono mb-2 uppercase">What are you saving?</legend>
                                    <div className="flex gap-4">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input type="radio" name="utype" checked={uploadType === 'song'} onChange={() => setUploadType('song')} className="accent-pink-500 focus:ring-1 focus:ring-pink-500"/>
                                            <span className="text-sm text-gray-300">Full Song</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input type="radio" name="utype" checked={uploadType === 'bank'} onChange={() => setUploadType('bank')} className="accent-pink-500 focus:ring-1 focus:ring-pink-500"/>
                                            <span className="text-sm text-gray-300">Pattern Bank</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input type="radio" name="utype" checked={uploadType === 'pattern'} onChange={() => setUploadType('pattern')} className="accent-pink-500 focus:ring-1 focus:ring-pink-500"/>
                                            <span className="text-sm text-gray-300">Current Pattern</span>
                                        </label>
                                    </div>
                                    <div className="text-[10px] text-gray-500 mt-2 italic">
                                        {uploadType === 'song' && "Saves arrangement, patterns, and knob settings."}
                                        {uploadType === 'bank' && "Saves all 8 pattern slots for all tracks."}
                                        {uploadType === 'pattern' && "Saves only the currently active pattern."}
                                    </div>
                                </fieldset>

                                <div>
                                    <label htmlFor="cloud-upload-name" className="block text-xs text-gray-400 font-mono mb-1">Name</label>
                                    <input
                                        id="cloud-upload-name"
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
                                    <label htmlFor="cloud-upload-author" className="block text-xs text-gray-400 font-mono mb-1">Author / Artist</label>
                                    <input
                                        id="cloud-upload-author"
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
                                    <label htmlFor="cloud-upload-desc" className="block text-xs text-gray-400 font-mono mb-1">Description (Optional)</label>
                                    <textarea
                                        id="cloud-upload-desc"
                                        maxLength={100}
                                        value={uploadForm.description}
                                        onChange={e => setUploadForm({...uploadForm, description: e.target.value})}
                                        className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white focus:border-pink-500 focus:outline-none transition-colors h-20 resize-none"
                                        placeholder="Style, bpm, mood..."
                                    />
                                </div>

                                <div className="pt-4" aria-live="polite">
                                    <button
                                        type="submit"
                                        disabled={uploadStatus === 'uploading' || uploadStatus === 'retrying' || uploadStatus === 'success'}
                                        className={`w-full py-3 rounded font-orbitron font-bold text-sm tracking-widest transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white
                                            ${uploadStatus === 'success' ? 'bg-green-600 text-white' :
                                              uploadStatus === 'error' ? 'bg-red-600 text-white' :
                                              uploadStatus === 'retrying' ? 'bg-yellow-600 text-white animate-pulse' :
                                              'bg-pink-700 text-white hover:bg-pink-600 border border-pink-500 shadow-[0_0_15px_rgba(236,72,153,0.3)]'}
                                        `}
                                    >
                                        {uploadStatus === 'uploading' ? 'UPLOADING...' : 
                                         uploadStatus === 'retrying' ? 'RETRYING...' :
                                         uploadStatus === 'success' ? 'UPLOAD COMPLETE!' : 
                                         uploadStatus === 'error' ? 'FAILED - RETRY?' :
                                         `UPLOAD ${uploadType.toUpperCase()}`}
                                    </button>
                                    {uploadStatus === 'error' && errorMessage && (
                                        <div className="text-center mt-2 text-red-400 text-xs font-mono bg-red-900/20 p-2 rounded border border-red-900">
                                            ERROR: {errorMessage}
                                        </div>
                                    )}
                                </div>
                            </form>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="border-t border-gray-800 p-4 bg-gray-900/50 flex justify-end">
                    <button onClick={onClose} aria-label="Close cloud library" title="Close cloud library" className="text-gray-400 text-xs font-mono hover:text-white px-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 rounded">CLOSE</button>
                </div>
            </div>
        </div>
    );
};
