# TTS Per-Bank Feature - Implementation Summary

## Problem Statement
The text-to-speech (TTS) function needed to be enhanced to support loading different text/speech to different sample banks. Previously, there was only one global TTS text field that was shared across all 8 banks. When switching banks, users would lose their text and couldn't maintain different TTS phrases for different samples.

## Solution Overview
Implemented per-bank TTS text storage that maintains independent text strings for each of the 8 sample banks. The text field now automatically displays and updates the text associated with the currently active bank.

## Key Features

### 1. Independent Text Per Bank
- Each of the 8 sample banks now has its own TTS text string
- Switching banks automatically displays the correct text
- Text changes only affect the currently active bank
- Default value: "Hello World" for each bank

### 2. Data Persistence
- TTS phrases are included in saved song data
- Export/import functionality preserves all 8 TTS phrases
- Cloud storage integration maintains TTS text
- Backward compatible with existing save files

### 3. Robust Validation
- Bounds checking for bank indices (0-7)
- Array length validation ensures 8 elements
- Graceful handling of missing or invalid data
- Console warnings for debugging

## Technical Implementation

### Files Modified

#### src/types.ts
- Added `ttsPhrases?: string[]` to `SavedSongData` interface
- Optional field for backward compatibility

#### src/components/SamplerPanel.tsx
- **Props Added:**
  - `ttsPhrases: string[]` - Array of 8 TTS text strings
  - `onTtsPhraseChange: (phrases: string[]) => void` - Callback to update phrases

- **State Changes:**
  - Removed local `ttsText` state
  - Added computed `currentTtsText` that reads from `ttsPhrases[activeBankIdx]`
  - Added `setCurrentTtsText()` helper that updates the array

- **Validation:**
  - Bounds checking on array access
  - Fallback to "Hello World" for missing data
  - Warning logs for invalid indices

#### src/App.tsx
- **New State:**
  ```typescript
  const [ttsPhrases, setTtsPhrases] = useState<string[]>(Array(8).fill("Hello World"));
  ```

- **Save Integration:**
  - `getSongData()` includes `ttsPhrases` in returned object
  - Dependency array updated to include `ttsPhrases`

- **Load Integration:**
  - `loadCloudData()` restores `ttsPhrases` from saved data
  - Validates array length (must be exactly 8)
  - Normalizes arrays with wrong length
  - Falls back to defaults for missing data

- **Component Integration:**
  - `SamplerPanel` receives `ttsPhrases` and `onTtsPhraseChange` props
  - Memoization includes `ttsPhrases` in dependency array

### Data Flow

```
User types in TTS field
    ↓
setCurrentTtsText(text)
    ↓
Creates new array: [...ttsPhrases] with updated index
    ↓
onTtsPhraseChange(newArray)
    ↓
App.tsx: setTtsPhrases(newArray)
    ↓
Component re-renders with new phrases
    ↓
currentTtsText shows updated value
```

### Bank Switching Flow

```
User clicks bank button
    ↓
onBankChange(newIndex)
    ↓
App.tsx: setActiveSamplerBank(newIndex)
    ↓
Component re-renders
    ↓
currentTtsText = ttsPhrases[newIndex]
    ↓
Input field displays new bank's text
```

## Testing

### Test Coverage
Created comprehensive test suite in `src/__tests__/SamplerPanel.test.tsx`:

1. **Basic Functionality:**
   - Displays correct text for active bank
   - Updates only current bank's text
   - Preserves text when switching banks

2. **UI Validation:**
   - Renders 8 bank selector buttons
   - Highlights active bank correctly
   - Bank buttons labeled 1-8

3. **Edge Cases:**
   - Invalid bank indices (out of range)
   - Empty ttsPhrases array
   - Array with wrong length
   - Missing ttsPhrases data

### Manual Testing Guide
See `TTS_PER_BANK_VERIFICATION.md` for detailed manual testing procedures including:
- Bank switching verification
- TTS generation per bank
- Save/load persistence testing
- Cloud storage integration

## Backward Compatibility

### Loading Old Files
When loading files saved before this feature:
- `ttsPhrases` will be `undefined`
- Code checks for existence: `if (songData.ttsPhrases && Array.isArray(songData.ttsPhrases))`
- Falls back to default: `Array(8).fill("Hello World")`
- No errors or data loss

### Saving Files
New saves include `ttsPhrases` array:
```json
{
  "version": 1,
  "pattern": {...},
  "params": {...},
  "ttsPhrases": [
    "Hello World",
    "Bank 2 text",
    "Hello World",
    ...
  ],
  ...
}
```

## Known Limitations

As noted in the original problem statement:
> "I can't test farther because the keys don't play anything on the livekeyboard in sampler mode right now"

This feature addresses the TTS text storage issue. The live keyboard playback issue is a separate concern not addressed by this implementation. Once the keyboard issue is resolved, users will be able to:
1. Set different TTS text for each bank
2. Generate TTS samples per bank
3. Play them via keyboard/sequencer
4. All text will persist correctly

## Future Enhancements

Potential improvements for future consideration:
1. Import/export TTS phrases separately from full songs
2. Copy/paste text between banks
3. Clear all banks at once
4. Preset phrases library
5. Character count/limit display
6. Text preview/validation

## Security Summary

### CodeQL Analysis
- **Status:** ✅ PASSED
- **Alerts:** 0
- **Findings:** No security vulnerabilities detected

### Code Review
- **Status:** ✅ PASSED
- **Issues:** 0 (after validation improvements)
- **Comments:** All initial concerns addressed with bounds checking and validation

### Security Considerations
- User input sanitization: Not required as text is only used for TTS generation
- XSS risk: None - text is not rendered as HTML
- Data validation: Implemented bounds checking and array length validation
- No external API calls from this code
- No credential or sensitive data handling

## Conclusion

The TTS per-bank feature has been successfully implemented with:
- ✅ Clean, minimal code changes
- ✅ Comprehensive validation and error handling
- ✅ Full test coverage
- ✅ Backward compatibility
- ✅ No security vulnerabilities
- ✅ Clear documentation

The implementation solves the stated problem: "Get the text-to-speech function able to load different text/speech to the different banks, so if you switch back to a sample to sequence it the text is also displayed/changable again."

Users can now maintain unique TTS text for each of the 8 sample banks, with full persistence across save/load operations.
