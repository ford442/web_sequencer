import React, { memo, useId } from 'react';
import { mixRgb, normalizedLightDir, resolveKnobCap, resolveKnobLighting, rgbToHex } from './knobMaterial';
import type { KnobMaterial, Rgb } from './knobMaterial';

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const WHITE: Rgb = { r: 1, g: 1, b: 1 };
const HALF = 24;
const CAP_R = 21;

interface KnobCapSvgProps {
    /** Pointer rotation in degrees (0 = up, + = clockwise), same as the classic needle. */
    rotation: number;
    material: KnobMaterial;
    /** Rendered size in px. @default 48 */
    size?: number;
}

/**
 * Classic-mode physical cap (#1581): knurled black skirt and brushed-metal top
 * that rotate with the value, a drop shadow from the material lighting, and a
 * static highlight that stays with the light. SVG filters/gradients only — no
 * canvas — so the classic knob keeps its DOM-only render path.
 */
export const KnobCapSvg = memo(({ rotation, material, size = 48 }: KnobCapSvgProps) => {
    const uid = useId().replace(/[^A-Za-z0-9_-]/g, '');
    const cap = resolveKnobCap(material);
    if (!cap) return null;
    const lighting = resolveKnobLighting(material);
    const [lx, ly] = normalizedLightDir(lighting);
    const topR = CAP_R * cap.topRadius;
    const pointer = material.pointer?.base ?? material.palette.needle;
    const shadow = lighting.dropShadow;
    const hlX = lx * topR * 0.42;
    const hlY = ly * topR * 0.42;
    const hlAngle = (Math.atan2(ly, lx) * 180) / Math.PI + 90;
    const knurl = Array.from({ length: cap.knurlCount }, (_, i) => (i * 360) / Math.max(1, cap.knurlCount));

    return (
        <svg
            className="absolute pointer-events-none"
            width={size}
            height={size}
            viewBox={`${-HALF} ${-HALF} ${HALF * 2} ${HALF * 2}`}
            style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
            data-testid="knob-needle"
            data-rotation={rotation}
            aria-hidden="true"
        >
            <defs>
                <radialGradient id={`${uid}-skirt`} cx={`${50 + lx * 18}%`} cy={`${50 + ly * 18}%`} r="75%">
                    <stop offset="0%" stopColor={rgbToHex(mixRgb(cap.body, WHITE, 0.22))} />
                    <stop offset="70%" stopColor={rgbToHex(cap.body)} />
                    <stop offset="100%" stopColor={rgbToHex(mixRgb(cap.body, BLACK, 0.6))} />
                </radialGradient>
                <linearGradient id={`${uid}-top`} gradientTransform={`rotate(${rotation + 45} 0.5 0.5)`}>
                    <stop offset="0" stopColor={rgbToHex(mixRgb(cap.topColor, WHITE, 0.3))} />
                    <stop offset="0.5" stopColor={rgbToHex(mixRgb(cap.topColor, BLACK, 0.28))} />
                    <stop offset="1" stopColor={rgbToHex(mixRgb(cap.topColor, WHITE, 0.35))} />
                </linearGradient>
                <filter id={`${uid}-drop`} x="-30%" y="-30%" width="160%" height="170%">
                    <feDropShadow
                        dx="0"
                        dy={CAP_R * shadow.offsetY}
                        stdDeviation={CAP_R * shadow.blur * 0.5}
                        floodOpacity={shadow.opacity}
                    />
                </filter>
            </defs>
            <circle r={CAP_R} fill={`url(#${uid}-skirt)`} filter={`url(#${uid}-drop)`} />
            <g transform={`rotate(${rotation})`} stroke="rgba(255,255,255,0.16)" strokeWidth={0.9}>
                {knurl.map((deg) => (
                    <line key={deg} x1={0} y1={-(topR + 1.6)} x2={0} y2={-(CAP_R - 0.8)} transform={`rotate(${deg})`} />
                ))}
            </g>
            <circle r={CAP_R - 0.5} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
            <circle r={topR + 0.8} fill="none" stroke="rgba(0,0,0,0.6)" strokeWidth={1.2} />
            <circle r={topR} fill={`url(#${uid}-top)`} />
            <line
                x1={0}
                y1={-topR * 0.2}
                x2={0}
                y2={-CAP_R * 0.9}
                transform={`rotate(${rotation})`}
                stroke={rgbToHex(pointer)}
                strokeWidth={2.4}
                strokeLinecap="round"
            />
            {/* Static highlight: stays with the light, does NOT rotate. */}
            <ellipse
                cx={hlX}
                cy={hlY}
                rx={topR * 0.46}
                ry={topR * 0.22}
                transform={`rotate(${hlAngle} ${hlX} ${hlY})`}
                fill="#ffffff"
                opacity={0.3}
            />
        </svg>
    );
});

KnobCapSvg.displayName = 'KnobCapSvg';
