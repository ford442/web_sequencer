import React, { memo, useCallback, useEffect, useState } from 'react';
export type { Knob2DDimensions, Knob2DDrawCommand } from './knobRender';
export { buildKnob2DDrawCalls } from './knobRender';
import { useCompactLayoutOptional } from '../contexts/CompactLayoutContext';
import type { AutomationTarget } from '../types';
import { automationStore, useAutomationStore } from '../stores/automationStore';
import { PanelTitleBar } from './ui/PanelChrome';
import { RackPanelChrome } from './ui/RackPanelChrome';
import { ExpressionLed } from './ExpressionLed';
import type { ExpressionLedTarget } from '../types';
import { KnobOverlay } from './KnobOverlay';
import { useHardwareModuleKnobRack } from '../hooks/useHardwareModuleKnobRack';

const KNOB_TEST_ID_SANITIZE_PATTERN = /[^A-Za-z0-9_-]/g;

export interface KnobConfig {
    id: string;
    label: string;
    x: number;
    y: number;
    size: number;
    value: number;
    isRecording?: boolean;
    /** True when an enabled automation lane is actively driving this parameter. */
    isAutomated?: boolean;
    /** Current normalized (0–1) automated value when isAutomated is true. */
    automatedValue?: number;
    valueDisplay?: string;
    /** Opt-in magnetic detent snap at 0 / 50% / 100%. */
    enableDetentSnap?: boolean;
    /** Haptic/audio tick when crossing a detent. */
    detentFeedback?: boolean | 'audio' | 'haptic' | 'both';
    isMidiMapped?: boolean;
    isMidiActive?: boolean;
    /** Lane preview for arc ghost curve on the knob face. */
    automationPreview?: {
        laneId: string;
        curveSamples: number[];
        hasLane: boolean;
        laneEnabled: boolean;
    };
    /** Dim knob when global automation highlight is on but param has no lane. */
    automationDimmed?: boolean;
}

interface HardwareModuleProps {
    title: string;
    colorHex: [number, number, number];
    controls: KnobConfig[];
    onParamChange: (id: string, value: number) => void;
    onRecordToggle?: (id: string) => void;
    children?: React.ReactNode;
    /** Optional badge rendered in the title bar (e.g. engine indicator pill). */
    titleBadge?: React.ReactNode;
    is3D?: boolean; // Kept for API compatibility; no longer drives knob rendering
    /** Automation target for MIDI learn / map (e.g. synthA, kick). */
    midiTarget?: AutomationTarget;
    onMidiTouch?: (paramId: string) => void;
    onMidiLearnStart?: (paramId: string) => void;
    isMidiMapped?: (paramId: string) => boolean;
    isMidiActive?: (paramId: string) => boolean;
    automationTarget?: AutomationTarget;
    patternIndex?: number;
    onAutomationNudge?: (paramId: string, value: number, step: number) => void;
    onAutomationPunchIn?: (paramId: string) => void;
    onAutomationLaneAction?: (action: 'toggle' | 'clear', paramId?: string) => void;
    /** Color-coded expression LED in the title bar. */
    expressionLedTarget?: ExpressionLedTarget;
    expressionLedAnalyser?: AnalyserNode | null;
    expressionLedFallbackColor?: string;
}

export const HardwareModule = memo(
    ({
        title,
        colorHex,
        controls,
        onParamChange,
        onRecordToggle,
        children,
        titleBadge,
        is3D = false,
        onMidiTouch,
        onMidiLearnStart,
        isMidiMapped,
        isMidiActive,
        automationTarget,
        patternIndex = 0,
        onAutomationNudge,
        onAutomationPunchIn,
        onAutomationLaneAction,
        expressionLedTarget,
        expressionLedAnalyser,
        expressionLedFallbackColor,
    }: HardwareModuleProps) => {
        const compactLayout = useCompactLayoutOptional();
        const isCompact = compactLayout?.isCompact ?? false;
        const { showHardwareAutomation } = useAutomationStore();
        const [automationMenu, setAutomationMenu] = useState<{
            x: number; y: number; paramId?: string; scope: 'knob' | 'panel';
        } | null>(null);
        const handleKnobContextMenu = useCallback((paramId: string, x: number, y: number) => {
            setAutomationMenu({ x, y, paramId, scope: 'knob' });
        }, []);

        const {
            containerRef, dragHudRef, sliderRefs, handleRegisterRef, setKnobCanvasRef,
            getCanvasValueAt, getAutomationOverlayAt,
        } = useHardwareModuleKnobRack({
            controls,
            onParamChange,
            onMidiTouch,
            onMidiLearnStart,
            automationTarget,
            onAutomationNudge,
            onAutomationPunchIn,
            onKnobContextMenu: onAutomationLaneAction ? handleKnobContextMenu : undefined,
            isCompact,
        });

        const handleHeaderContextMenu = useCallback((e: React.MouseEvent) => {
            if (!automationTarget || !onAutomationLaneAction) return;
            e.preventDefault();
            setAutomationMenu({ x: e.clientX, y: e.clientY, scope: 'panel' });
        }, [automationTarget, onAutomationLaneAction]);

        const showAutomationOverlay = showHardwareAutomation;

        const closeAutomationMenu = useCallback(() => setAutomationMenu(null), []);

        useEffect(() => {
            if (!automationMenu) return;
            const onDocClick = () => closeAutomationMenu();
            document.addEventListener('click', onDocClick);
            return () => document.removeEventListener('click', onDocClick);
        }, [automationMenu, closeAutomationMenu]);

        return (
            <div ref={containerRef} className={`relative touch-none hyphon-chrome-panel hyphon-rack-surface ${children ? 'overflow-visible' : 'overflow-hidden'}`} style={{ width: '100%', height: '100%', minHeight: isCompact ? '260px' : '220px' }}>
                <RackPanelChrome vents />
                {automationMenu && onAutomationLaneAction && (
                    <div
                        className="fixed z-[100] min-w-[140px] bg-zinc-950 border border-cyan-800/50 rounded shadow-lg py-1 text-[10px] font-mono"
                        style={{ left: automationMenu.x, top: automationMenu.y }}
                        role="menu"
                    >
                        <button
                            type="button"
                            className="block w-full text-left px-3 py-1.5 hover:bg-cyan-950/50 text-cyan-200"
                            onClick={() => {
                                onAutomationLaneAction('toggle', automationMenu.paramId);
                                closeAutomationMenu();
                            }}
                        >
                            {automationMenu.scope === 'panel' ? 'Toggle all lanes' : 'Toggle lane'}
                        </button>
                        <button
                            type="button"
                            className="block w-full text-left px-3 py-1.5 hover:bg-red-950/40 text-red-300"
                            onClick={() => {
                                onAutomationLaneAction('clear', automationMenu.paramId);
                                closeAutomationMenu();
                            }}
                        >
                            {automationMenu.scope === 'panel' ? 'Clear all lanes' : 'Clear lane'}
                        </button>
                        <button
                            type="button"
                            className="block w-full text-left px-3 py-1.5 text-gray-500 hover:bg-zinc-900"
                            onClick={closeAutomationMenu}
                        >
                            Cancel
                        </button>
                    </div>
                )}
                <div
                    ref={dragHudRef}
                    className="absolute top-1 right-2 z-50 hidden text-[9px] font-mono font-bold tracking-widest px-1.5 py-0.5 rounded bg-black/85 pointer-events-none"
                    aria-hidden="true"
                />
                {controls.map((c, i) => (
                    <div
                        key={c.id}
                        className="absolute pointer-events-none"
                        style={{
                            left: `${c.x * 100}%`,
                            top: `${c.y * 100}%`,
                            transform: 'translate(-50%, -50%)',
                        }}
                    >
                        <canvas
                            ref={setKnobCanvasRef(i)}
                            data-testid={`hardware-knob-canvas-${String(c.id).replace(KNOB_TEST_ID_SANITIZE_PATTERN, '_')}`}
                            className="block w-full h-full"
                            style={{ pointerEvents: 'none' }}
                        />
                    </div>
                ))}
                <div className="absolute inset-0 pointer-events-none">
                    <PanelTitleBar
                        title={title}
                        badge={titleBadge}
                        onContextMenu={handleHeaderContextMenu}
                        actions={(
                            <>
                                {expressionLedTarget && expressionLedFallbackColor && (
                                    <ExpressionLed
                                        target={expressionLedTarget}
                                        analyserNode={expressionLedAnalyser}
                                        fallbackColor={expressionLedFallbackColor}
                                        className="pointer-events-auto mr-1"
                                        aria-label={`${title} activity`}
                                    />
                                )}
                                {automationTarget ? (
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); automationStore.toggleShowHardwareAutomation(); }}
                                        className={`text-[7px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border pointer-events-auto ${
                                            showAutomationOverlay
                                                ? 'bg-cyan-900/80 text-cyan-200 border-cyan-500/60'
                                                : 'bg-gray-900/80 text-gray-500 border-gray-700'
                                        }`}
                                        title="Toggle automation curve overlay on knobs"
                                        aria-pressed={showAutomationOverlay}
                                    >
                                        AUTO
                                    </button>
                                ) : undefined}
                            </>
                        )}
                    />

                    {controls.map((c, i) => (
                        <KnobOverlay
                            key={c.id}
                            id={c.id}
                            label={c.label}
                            x={c.x}
                            y={c.y}
                            size={c.size}
                            value={c.value}
                            valueDisplay={c.valueDisplay}
                            isRecording={c.isRecording}
                            isAutomated={c.isAutomated}
                            automatedValue={c.automatedValue}
                            isMidiMapped={c.isMidiMapped ?? isMidiMapped?.(c.id)}
                            isMidiActive={c.isMidiActive ?? isMidiActive?.(c.id)}
                            automationPreview={c.automationPreview}
                            automationDimmed={c.automationDimmed}
                            showAutomationOverlay={showAutomationOverlay}
                            indicatorValue={
                                (c.isAutomated || c.isRecording)
                                    ? (c.isAutomated && c.automatedValue !== undefined ? c.automatedValue : c.value)
                                    : undefined
                            }
                            colorHex={colorHex}
                            index={i}
                            onParamChange={onParamChange}
                            onRecordToggle={onRecordToggle}
                            onRegisterRef={handleRegisterRef}
                            compact={isCompact}
                        />
                    ))}
                </div>
                {children && <div className="absolute inset-0 pointer-events-none">{children}</div>}
            </div>
        );
    });
