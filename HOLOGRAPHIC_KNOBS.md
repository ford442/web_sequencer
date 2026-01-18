# 3D Holographic Knobs Implementation

## Overview
This implementation adds holographic visual effects to the knobs in the Hardware Module when the application is in 3D mode.

## Changes Made

### 1. HardwareModule Component (`src/components/HardwareModule.tsx`)
- Added `is3D?: boolean` prop to enable holographic shader in 3D mode
- Implemented dual shader system:
  - **Standard Shader** (2D mode): Original clean knob rendering
  - **Holographic Shader** (3D mode): Advanced visual effects

### 2. App Component (`src/App.tsx`)
- Updated all `HardwareModule` instances to pass `is3D={is3DMode}` prop
- Affects all instrument panels: Synth A, Synth B, Kick, Snare, Closed Hat, Open Hat, and Sampler

## Holographic Shader Features

The holographic shader includes the following visual effects:

1. **Outer Glow/Halo Effect**
   - Pulsing glow around each knob
   - Color matches the module's accent color
   - Animated with breathing effect using sine wave

2. **Rotating Data Ring**
   - Dashed circular pattern at 85% of knob radius
   - Rotates slowly around the knob center
   - Creates a futuristic UI appearance

3. **Inner Holographic Disc**
   - Fresnel effect that creates rim lighting
   - Color intensity increases toward edges
   - Gives knobs a "projected" holographic look

4. **Holographic Shimmer**
   - Animated wave pattern across knob surface
   - Creates a dynamic, scanning effect
   - Uses sine wave based on distance and time

5. **Holographic Scanlines**
   - Horizontal scan lines across entire panel
   - Animated vertically
   - Adds authentic holographic display feel

6. **Glowing Needle Indicator**
   - Shows current knob value
   - Enhanced with glow effect in 3D mode
   - White hot center with colored glow

7. **Glitch Effect**
   - Occasional visual artifacts
   - Adds to the holographic aesthetic
   - Random timing based on position and time

## Technical Implementation

### Shader Structure
- Uses WebGPU for rendering
- Fragment shader receives uniforms: time, ratio, color, values, positions
- Supports up to 12 knobs per panel
- Optimized with array-based position storage

### Performance Considerations
- Shader only recompiles when switching between 2D and 3D modes
- Uses efficient uniform buffer updates
- Single render pass per frame
- Device properly destroyed on unmount

### Color System
Each module has its own accent color passed via `colorHex` prop:
- Lead Synth: Cyan
- Bass Synth: Pink  
- Kick: Yellow
- Snare: Yellow
- Hats: Yellow
- Sampler: Purple

The holographic effects use these colors for glows, rings, and highlights.

## Usage

### Activating 3D Mode
1. Click the "3D VIEW" button in the application header
2. Navigate through the 3D studio environment
3. Select different modules from the rack selector
4. Observe holographic knobs in action

### Switching Back to 2D Mode
1. Click "EXIT 3D VIEW" button
2. Knobs return to standard rendering
3. No performance impact on 2D mode

## Browser Requirements
- WebGPU-compatible browser (Chrome 113+, Edge 113+)
- Hardware acceleration enabled
- Modern GPU with compute shader support

## Future Enhancements
- Add user preference for holographic intensity
- Include more holographic effects (particles, beams)
- Add color customization options
- Implement accessibility mode toggle
