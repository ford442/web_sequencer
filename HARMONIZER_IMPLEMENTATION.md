# Harmonizer Feature Implementation

## Overview
Added a **HARMONIZE** button to the SamplerVoicePanel that creates 2-4 layered vocal voices with formant variation and slight detune for rich, choir-like textures.

## Files Created/Modified

### 1. `src/engines/Harmonizer.ts` (NEW)
The core harmonizer engine that:
- Generates 2-4 voice configurations with different pitches, detunes, and formant shifts
- Supports 5 harmony types: Octave, Fifth, Third, Cluster, Custom
- Provides quick presets: Subtle, Classic, Choir, Power, Ambient
- Calculates voice panning and gain distribution for natural stereo spread

**Key Classes/Types:**
- `Harmonizer` - Main class for generating harmony voices
- `HarmonizerConfig` - Configuration interface
- `HarmonyVoiceParams` - Parameters for each generated voice
- `HARMONIZE_PRESETS` - Quick preset factory functions

### 2. `src/components/SamplerVoicePanel.tsx` (MODIFIED)
Added:
- **HARMONIZE** button in the RubberBand section with holographic styling
- Harmonizer popover with:
  - Voice count selector (2, 3, 4 buttons)
  - Harmony type selector (Octave, Fifth, Third, Cluster, Custom)
  - Detune spread slider (0-50 cents)
  - Formant spread slider (0-12 semitones)
  - Quick preset buttons (DBL, 3RD, CHR, 5TH)
  - APPLY button
- Visual indicator when harmonize is active

**Props Added:**
- `harmonizerConfig?: HarmonizerConfig`
- `onHarmonizerConfigChange?: (config: HarmonizerConfig, isActive: boolean) => void`
- `isHarmonizeActive?: boolean`

### 3. `src/App.tsx` (MODIFIED)
Added:
- Harmonizer state management
- `handleHarmonizerConfigChange` callback
- Props passed to SamplerVoicePanel
- Toast notifications for harmonize state changes

### 4. `src/hooks/useAudioEngine.ts` (MODIFIED)
Added:
- `setHarmonizerConfig` function to configure harmonizer
- `playSamplerVoice` internal function for single-voice playback
- Modified `playSampler` to detect harmonizer state and generate multiple voices
- Each harmony voice gets:
  - Pitch offset based on harmony type
  - Independent detune in cents
  - Formant shift adjustment
  - Stereo panning position
  - Gain scaling

### 5. `src/types.ts` (MODIFIED)
Added to `SamplerBankParams`:
- `pan?: number` - Stereo pan position
- `isHarmonyVoice?: boolean` - Flag for harmony voices
- `harmonyIndex?: number` - Voice index in harmony

Added to `AudioEngine`:
- `setHarmonizerConfig?: (config: HarmonizerConfig, isActive: boolean) => void`

## Usage

### UI Flow
1. Select the **SAMPLER** track
2. Click the **HARMONIZE** button in the voice panel
3. Configure in the popover:
   - Select 2-4 voices
   - Choose harmony type
   - Adjust detune spread (subtle chorusing)
   - Adjust formant spread (vocal character variation)
4. Click **APPLY** to activate

### Harmony Types
- **Octave**: Root + Octave (doubling effect)
- **Fifth**: Root + Perfect Fifth (power chord style)
- **Third**: Root + Major Third (classic harmony)
- **Cluster**: Tight cluster around root (dense texture)
- **Custom**: User-defined intervals

### Quick Presets
- **DBL**: Subtle doubling with 8¢ detune
- **3RD**: Classic vocal harmony (2 voices, major third)
- **CHR**: Rich choir (4 voices, cluster)
- **5TH**: Power chord (root + fifth)

## Technical Details

### Voice Generation Algorithm
```typescript
// Each voice gets:
pitchOffset = intervals[voiceIndex]  // Based on harmony type
detuneCents = random(-detuneSpread, detuneSpread) + alternatingBias
formantShift = spreadAcrossVoices(-spread/2, +spread/2)
pan = stereoDistribution(voiceCount)  // [-0.6, -0.2, 0.2, 0.6] for 4 voices
gain = voiceBlending(voiceCount)      // Center voices slightly louder
```

### Integration with Playback
When harmonize is active and mode is 'stretch':
1. Harmonizer generates voice array
2. Each voice plays with `playSamplerVoice()`
3. Pitch offset applied to MIDI notes
4. Formant shift applied via RubberBand
5. Stereo panning creates spatial width
6. Independent detune adds natural variation

### Visual Design
- Holographic aesthetic matching the app
- Cyan/purple gradient accents
- Glowing active state indicator
- Smooth popover animations
- Real-time config display

## Future Enhancements
- MIDI learn for harmonize toggle
- Per-bank harmonizer settings
- Automation recording of harmonize params
- Export harmonized voices as separate stems
- Custom interval input for precise control
