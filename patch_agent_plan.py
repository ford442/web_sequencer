import sys
import datetime

def modify_file():
    filepath = "agent_plan.md"
    with open(filepath, 'r') as f:
        content = f.read()

    date_str = datetime.datetime.now().strftime("%Y-%m-%d")

    changelog_marker = "## 📜 Changelog"
    changelog_entry = f"## 📜 Changelog\n* [{date_str}] - Implemented Dynamic Formant Pitch Link: Added `formantPitchLink` to `Note` and `SamplerBankParams`. Updated `useAudioEngine.ts` to dynamically scale formant shifts proportionally to pitch shifts, enabling realistic vocal glides. Wired controls into `SamplerPanel` and `NoteSelector`. Fulfills the \"Dynamic Formant Pitch Link\" Innovation Lab idea. Added new idea: \"Global Tape Saturation Profile\"."

    if changelog_marker in content:
        content = content.replace(changelog_marker, changelog_entry)
        with open(filepath, 'w') as f:
            f.write(content)
        print("Updated changelog in agent_plan.md")
    else:
        print("Changelog marker not found")

if __name__ == "__main__":
    modify_file()
