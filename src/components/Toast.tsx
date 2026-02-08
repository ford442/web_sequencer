import React, { useEffect } from 'react';

interface ToastProps {
  message: string;
  type: 'success' | 'error';
  onClose: () => void;
}

export const Toast: React.FC<ToastProps> = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] px-4 py-2 rounded shadow-lg border animate-in slide-in-from-top-2 fade-in duration-300 flex items-center gap-2 ${
      type === 'success' ? 'bg-green-900/90 border-green-500 text-green-100' : 'bg-red-900/90 border-red-500 text-red-100'
    }`} role="alert">
      <span>{type === 'success' ? '✓' : '⚠'}</span>
      <span className="font-mono text-sm">{message}</span>
    </div>
  );
};
