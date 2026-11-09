import React, { memo } from 'react';
import type { OscillatorType } from '../../types';

/**
 * Signature glyph per oscillator family (#1587), drawn on a 16×16 grid in
 * `currentColor` so it takes the button / LCD colour it sits in. Each glyph
 * echoes the family's panel art: JS braces, PCM sample stems, Open303 square,
 * JC303 saw + pulse-width dot, Prophecy formant humps, Pyodide snake, WebGPU
 * hex core, WAM module blocks, Macro knob cluster.
 */
const GLYPHS: Record<OscillatorType, React.ReactNode> = {
    javascript: (
        <>
            <path d="M6 2.5c-1.4 0-2 .7-2 2v1.4c0 .9-.5 1.6-1.5 1.6 1 0 1.5.7 1.5 1.6v1.4c0 1.3.6 2 2 2" />
            <path d="M10 2.5c1.4 0 2 .7 2 2v1.4c0 .9.5 1.6 1.5 1.6-1 0-1.5.7-1.5 1.6v1.4c0 1.3-.6 2-2 2" />
        </>
    ),
    pcm: <path d="M2 8v0M4.5 5v6M7 3v10M9.5 6v4M12 4v8M14.5 7v2" />,
    open303: <path d="M1.5 11.5h3v-7h3.5v7h3.5v-7h3" />,
    jc303: (
        <>
            <path d="M1.5 12 6 4v8l4.5-8v8" />
            <circle cx="13.5" cy="5" r="1.4" fill="currentColor" stroke="none" />
        </>
    ),
    prophecy: <path d="M1 12.5c2 0 2-8.5 4-8.5s2 6 3.5 6 1.8-3.5 3-3.5 1.8 6 3.5 6" />,
    pyodide: (
        <>
            <path d="M10.5 2.5H7.2a2.2 2.2 0 0 0-2.2 2.2v1.8h4.5" />
            <path d="M5.5 13.5h3.3a2.2 2.2 0 0 0 2.2-2.2V9.5H6.5" />
            <path d="M5 6.5H3.7A1.7 1.7 0 0 0 2 8.2v.1c0 .9.8 1.7 1.7 1.7h2.8M11 9.5h1.3A1.7 1.7 0 0 0 14 7.8v-.1c0-.9-.8-1.7-1.7-1.7H9.5" />
        </>
    ),
    webgpu: (
        <>
            <path d="M8 1.5l5.6 3.2v6.6L8 14.5l-5.6-3.2V4.7z" />
            <path d="M8 5.2l2.4 1.4v2.8L8 10.8 5.6 9.4V6.6z" />
        </>
    ),
    wam: (
        <>
            <rect x="2" y="2" width="5" height="5" rx="1" />
            <rect x="9" y="2" width="5" height="5" rx="1" />
            <rect x="2" y="9" width="5" height="5" rx="1" />
            <rect x="9" y="9" width="5" height="5" rx="1" fill="currentColor" />
        </>
    ),
    macro: (
        <>
            <circle cx="4.5" cy="4.5" r="2.5" />
            <circle cx="11.5" cy="4.5" r="2.5" />
            <circle cx="4.5" cy="11.5" r="2.5" />
            <circle cx="11.5" cy="11.5" r="2.5" />
            <path d="M4.5 4.5 3.2 3M11.5 4.5l1.6-1M4.5 11.5l-.2 1.9M11.5 11.5l1.8.4" />
        </>
    ),
};

interface OscillatorSignatureIconProps {
    type: OscillatorType;
    className?: string;
    /** When set the icon is announced (role="img"); otherwise it is decorative. */
    title?: string;
}

export const OscillatorSignatureIcon = memo(({ type, className = 'w-3.5 h-3.5', title }: OscillatorSignatureIconProps) => (
    <svg
        viewBox="0 0 16 16"
        className={className}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        data-osc-icon={type}
        role={title ? 'img' : undefined}
        aria-label={title}
        aria-hidden={title ? undefined : true}
        focusable="false"
    >
        {title && <title>{title}</title>}
        {GLYPHS[type]}
    </svg>
));

OscillatorSignatureIcon.displayName = 'OscillatorSignatureIcon';
