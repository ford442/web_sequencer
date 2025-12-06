
from playwright.sync_api import sync_playwright, expect
import time

def verify_wasm_ui():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the app (assuming default Vite port)
        page.goto("http://localhost:5173/")

        # Wait for app to load - waiting for the ELECTRIBE title
        page.wait_for_selector("text=ELECTRIBE")

        # The sequencer has rows. The rows are "LEAD", "BASS", etc.
        # "LEAD" corresponds to partA.
        # The module panel at the bottom shows "SYNTH A // LEAD" by default usually as selectedTrack is 'partA'.

        # We need to find the WaveformSelector.
        # It's inside the HardwareModule.
        # It has buttons.
        # Let's locate the WAM SAW button.
        # It has text "WAM" and "SAW".

        # Let's wait for the "WAM" text to be visible.
        # Since there are multiple WAM buttons, we can just look for the first one.

        # Using a text locator for "WAM"
        wam_locator = page.locator("text=WAM").first

        # Expect it to be visible
        expect(wam_locator).to_be_visible(timeout=10000)

        # Also verify the class text-yellow-500 is present on the WAM buttons
        # The WAM button content: <div className="font-bold text-[10px] leading-none text-center text-yellow-500">WAM<br/>SAW</div>

        yellow_text = page.locator(".text-yellow-500").first
        expect(yellow_text).to_be_visible()

        # Take screenshot of the Hardware Module area (bottom of screen)
        # We can take a full page screenshot.
        page.screenshot(path="verification/wasm_ui.png")

        print("Screenshot taken at verification/wasm_ui.png")
        browser.close()

if __name__ == "__main__":
    verify_wasm_ui()
