# Manual Verification Guide: TTS Per-Bank Feature

## Feature Overview
The text-to-speech (TTS) functionality now supports independent text input for each of the 8 sample banks. When you switch banks, the text field displays and edits the text associated with that specific bank.

## Verification Steps

### 1. Bank Switching and Text Persistence

**Test**: Verify each bank maintains its own TTS text

1. Open the application
2. Select the Sampler track
3. In bank 1, enter "Hello from bank one" in the TTS text field
4. Click bank 2 selector button
5. Verify the text field is now empty or shows default "Hello World"
6. Enter "This is bank two" in the text field
7. Click bank 3 and enter "Bank three speaking"
8. Switch back to bank 1
9. **Expected**: Text field should show "Hello from bank one"
10. Switch to bank 2
11. **Expected**: Text field should show "This is bank two"
12. Repeat for all 8 banks

**Success Criteria**: Each bank's text is preserved when switching between banks

---

### 2. TTS Generation Per Bank

**Test**: Verify TTS generates different audio for different text in different banks

1. In bank 1, enter "Alpha" and click GEN button
2. Wait for generation to complete
3. Switch to bank 2, enter "Bravo" and click GEN
4. Switch to bank 3, enter "Charlie" and click GEN
5. Switch to bank 4, enter "Delta" and click GEN
6. Place notes on the sequencer for the sampler track
7. While playing, switch between banks using the bank selector buttons
8. **Expected**: Each bank should play its unique TTS-generated sample

**Success Criteria**: Different TTS samples play for each bank

---

### 3. Save and Load Persistence

**Test**: Verify TTS text persists across save/load operations

1. Set unique text for each bank:
   - Bank 1: "One"
   - Bank 2: "Two"
   - Bank 3: "Three"
   - Bank 4: "Four"
   - Bank 5: "Five"
   - Bank 6: "Six"
   - Bank 7: "Seven"
   - Bank 8: "Eight"

2. Click the "Export Song" button to save your project
3. Clear/reset the project (reload page or start new)
4. Click "Import Song" and load the saved file
5. Switch through all 8 banks
6. **Expected**: Each bank should show the correct text that was saved

**Success Criteria**: All TTS phrases are restored from saved file

---

### 4. Cloud Storage Integration

**Test**: Verify TTS text persists when saving/loading from cloud

1. Set different text in banks 1-4
2. Save the song to cloud storage
3. Clear/reset the project
4. Load the song from cloud storage
5. Verify all bank texts are restored

**Success Criteria**: Cloud save/load preserves TTS phrases

---

## Known Limitations

As mentioned in the problem statement:
> "Right now it loads and generates one tts sample ok, but I can't test farther because the keys don't play anything on the livekeyboard in sampler mode right now."

The live keyboard issue is a separate problem not addressed by this implementation. This feature ensures that:
- TTS text is properly stored per bank
- Text persists when switching banks
- Text is saved/loaded with projects

Once the live keyboard issue is resolved, the TTS samples should play correctly when triggered.

---

## Technical Details

### Data Structure
- `ttsPhrases`: Array of 8 strings stored in App state
- Default value: `["Hello World", "Hello World", ...]` (8 elements)
- Persisted in `SavedSongData.ttsPhrases`

### Component Flow
1. User types in TTS input field in SamplerPanel
2. `setCurrentTtsText()` creates new array with updated text at active bank index
3. `onTtsPhraseChange()` callback updates App state
4. When bank switches, `currentTtsText` computed value shows correct bank's text

### Backward Compatibility
- Files saved without `ttsPhrases` will default to "Hello World" for all banks
- No breaking changes to existing save files
