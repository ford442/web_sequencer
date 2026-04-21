# Visual Comparison: Standard vs Holographic Knobs

## Standard Knobs (2D Mode)
The standard knobs feature:
- Simple circular design
- Colored ring at 75% radius
- Metallic inner disc with shine
- White indicator needle
- Subtle grain texture background
- Clean, professional look

## Holographic Knobs (3D Mode)
The holographic knobs feature:

### Outer Effects
- **Pulsing Halo**: Extends 20% beyond knob radius
  - Fades smoothly from edge to knob
  - Animated breathing effect (0.8-1.0 intensity)
  - Uses module's accent color

### Rotating Elements
- **Data Ring**: Located at 85% radius
  - Dashed pattern (15 segments)
  - Rotates at 0.5 rad/sec
  - Appears only in specific segments (dash > 0.3)
  - Bright accent color (1.5x normal)

### Inner Disc
- **Fresnel Effect**: Creates rim lighting
  - Stronger at edges, weaker at center
  - Formula: pow(1.0 - (dist / radius), 2.0)
  - 40% mix with accent color at 30% intensity

- **Shimmer Effect**: Animated wave pattern
  - Formula: sin(dist * 100.0 - time * 10.0)
  - 15% additional accent color contribution
  - Creates scanning/flowing appearance

### Needle Indicator
- **Enhanced Glow**: Brighter, more visible
  - Formula: 1.0 / (perp_dist * 80.0 + 1.0)
  - 80% mix to white (hot center)
  - 50% additional colored glow

### Background Effects
- **Holographic Scanlines**
  - Horizontal lines at 300px frequency
  - Scroll upward at 8 units/sec
  - 8% intensity variation
  - Applied to entire panel

- **Glitch Artifacts**
  - Appear at 97% threshold
  - Random based on position and time
  - 20% colored flash when active

## Color Usage by Module

| Module | Color (RGB) | Hex |
|--------|------------|-----|
| Lead Synth A | Cyan | #06b6d4 |
| Bass Synth B | Pink | #ec4899 |
| Kick Drum | Yellow | #eab308 |
| Snare Drum | Yellow | #eab308 |
| Closed Hat | Yellow | #eab308 |
| Open Hat | Yellow | #eab308 |
| Sampler | Purple | #a855f7 |

## Animation Timings

| Effect | Speed | Formula |
|--------|-------|---------|
| Halo Pulse | ~2.1 sec/cycle | sin(time * 3.0) |
| Ring Rotation | ~12.6 sec/rotation | time * 0.5 rad/sec |
| Scanlines | ~0.79 sec/cycle | time * 8.0 |
| Shimmer | ~0.63 sec/cycle | time * 10.0 |
| Glitch | ~0.42 sec/cycle | time * 15.0 |
| Glitch Flash | ~0.063 sec/cycle | time * 100.0 |

## Technical Shader Differences

### Standard Shader (2D)
- Background: RGB(0.12, 0.14, 0.16)
- Grain: 3% intensity
- Scanlines: 10% intensity, 200px frequency
- Ring: 1.5% width at 75% radius
- Needle: 0.5% width, sharp white

### Holographic Shader (3D)
- Background: RGB(0.08, 0.10, 0.12) - darker
- Grain: 2% intensity - subtler
- Scanlines: 8% intensity, 300px frequency - finer
- Ring: 1.0% width at 85% radius - thinner, outer
- Needle: 1.5% width, glowing white with colored aura

## Performance Impact
- Both shaders run at same framerate
- Holographic adds:
  - 1 rotation matrix calculation per knob
  - 2 additional conditionals per knob
  - 1 global glitch calculation
- Negligible impact on modern GPUs
- No CPU overhead difference

## Accessibility
- Same interaction model for both modes
- Visual indicators more prominent in 3D mode
- Keyboard navigation unchanged
- Screen reader support identical
- High contrast mode not affected
