import React from 'react';

interface LoadingButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    isLoading?: boolean;
    loadingText?: string;
    spinnerColor?: string; // Optional custom color for the spinner
}

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const LoadingButton: React.FC<LoadingButtonProps> = React.memo(({
    isLoading = false,
    loadingText,
    spinnerColor = 'text-current',
    disabled,
    children,
    className = '',
    ...props
}) => {
    return (
        <button type="button"
            {...props}
            disabled={disabled || isLoading}
            aria-busy={isLoading}
            aria-label={props['aria-label'] || (typeof children === 'string' ? children : loadingText)}
            className={`transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
                isLoading ? 'opacity-70 cursor-wait' : disabled ? 'opacity-50 cursor-not-allowed' : ''
            } ${className}`}
        >
            {isLoading && (
                <svg
                    aria-hidden="true"
                    focusable="false"
                    className={`animate-spin h-4 w-4 mr-2 inline-block ${spinnerColor}`}
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                >
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                </svg>
            )}
            {isLoading && loadingText ? loadingText : children}
        </button>
    );
});
