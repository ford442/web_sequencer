/**
 * Rubber Band Enhancement Modules
 * 
 * This directory contains modules implementing the RUBBERBAND_ENHANCEMENT_PLAN.md
 * for high-quality vocal synthesis in the web_sequencer project.
 * 
 * Architecture Overview:
 * ----------------------
 * The modules work together to provide a complete vocal synthesis pipeline:
 * 
 * 1. PhonemeAligner (Section 3) - Aligns TTS output to phoneme boundaries
 * 2. FormantShifter (Section 4) - Independent formant control for vocal character
 * 3. ExpressiveVoiceProcessor (Section 5) - Vibrato, tremolo, breath effects
 * 4. HybridNeuralPipeline (Section 6) - Neural vocoding integration
 * 5. PerformanceOptimizer (Section 7) - Real-time performance optimization
 * 6. ConcatenativeHybrid (Section 8) - TTS + real sample blending
 * 7. ArtifactDetector (Section 10) - Quality monitoring
 * 
 * Implementation Status:
 * ----------------------
 * - Section 1 (Vocal Fidelity): IMPLEMENTED in rubberband-processor.ts
 * - Section 2 (Multi-Resolution Pitch): IMPLEMENTED in SingingVoice.ts
 * - Section 3 (Phoneme Alignment): CTC (wav2vec2 ONNX) + G2P heuristic fallback
 * - Section 4 (Formant): IMPLEMENTED in FormantShifter.ts (wired when enableFormantShifting)
 * - Section 5 (Expression): IMPLEMENTED in ExpressiveVoiceProcessor / worklet
 * - Section 6 (Hybrid Neural): library + tests; freeze/export wiring is V4 follow-up
 * - Section 8 (Concatenative): STUB — V2 follow-up
 * - Section 9 (Latency): LatencyCompensator deleted; MIDI clock is TransportClockController
 * - Section 10 (Artifacts): ArtifactDetector present
 * 
 * Usage:
 * ------
 * Import individual modules as needed:
 * 
 * ```typescript
 * import { SingingVoice } from '../engines/SingingVoice';
 * import { ExpressiveVoiceProcessor } from '../engines/rubberband/ExpressiveVoiceProcessor';
 * ```
 * 
 * Or import everything:
 * 
 * ```typescript
 * import * as RubberbandEnhancements from '../engines/rubberband';
 * ```
 * 
 * @see RUBBERBAND_ENHANCEMENT_PLAN.md for detailed implementation plan
 * @see RUBBERBAND_DESIGN.md for architectural context
 */

// Section 3: Phoneme-Aware Time Stretching
export * from './PhonemeAligner';
export { CtcForcedAligner, CTC_MODEL_URL } from './alignment/ctcForcedAligner';

// Section 4: Formant Shifting for Vocal Character
export * from './FormantShifter';

// Section 5: Expressiveness Layer (Vibrato, Dynamics)
export * from './ExpressiveVoiceProcessor';

// Section 6: Hybrid Neural + Rubber Band Approach
export * from './HybridNeuralPipeline';

// Section 7: Real-Time Performance Optimizations
export * from './performance';

// Section 8: Advanced Concatenative Hybrid
export * from './ConcatenativeHybrid';

// Section 10: Quality Assurance - Artifact Detection
export * from './ArtifactDetector';
