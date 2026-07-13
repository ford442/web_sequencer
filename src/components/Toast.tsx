import React, { useEffect } from 'react';

interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'info';
  onClose: () => void;
}

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const Toast: React.FC<ToastProps> = React.memo(({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] px-4 py-2 rounded shadow-lg border animate-in slide-in-from-top-2 fade-in duration-300 flex items-center gap-3 ${
      type === 'success' ? 'bg-green-900/90 border-green-500 text-green-100' : 'bg-red-900/90 border-red-500 text-red-100'
    }`} role="alert" aria-live="polite">
      <span aria-hidden="true">{type === 'success' ? '✓' : '⚠'}</span>
      <span className="font-mono text-sm">{message}</span>
      <button
        type="button"
        onClick={onClose}
        className={`ml-2 hover:opacity-75 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 rounded p-0.5 transition-opacity ${type === 'success' ? 'focus-visible:ring-green-400' : 'focus-visible:ring-red-400'}`}
        aria-label="Close notification"
        title="Close notification"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
});
