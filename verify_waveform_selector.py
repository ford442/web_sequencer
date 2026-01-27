
import re
import time
from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()

    # Navigate to the app
    try:
        page.goto("http://localhost:5173")
    except Exception as e:
        print(f"Failed to load page: {e}")
        browser.close()
        return

    # Wait for the system to be ready and click start
    try:
        # Wait for button to be enabled
        start_button = page.get_by_role("button", name="INITIALIZE SYSTEM")
        start_button.wait_for(state="visible", timeout=60000) # Increased timeout
        start_button.click()
        print("Clicked Start Button")
    except Exception as e:
        print(f"Start button interaction failed: {e}")
        page.screenshot(path="verification_failure_start.png")
        # Try to remove overlay anyway to proceed
        page.evaluate("document.querySelector('[role=dialog]')?.remove()")

    # Wait for potential animation
    time.sleep(2)

    # Force remove overlay if still present
    try:
        if page.locator("[role=dialog]").is_visible():
            print("Overlay still visible, removing manually...")
            page.evaluate("document.querySelector('[role=dialog]').remove()")
    except:
        pass

    # Locate the WaveformSelector trigger
    try:
        # regex for aria-label
        trigger = page.get_by_label(re.compile(r"Current waveform:.*"))
        trigger.first.wait_for(state="visible", timeout=5000)

        # Click to open popover
        trigger.first.click()
        print("Clicked Waveform Selector")

        # Wait for popover to appear
        # The popover has text "BASIC", "VINTAGE", etc.
        page.get_by_text("BASIC").wait_for(state="visible", timeout=5000)
        print("Popover is visible")

        # Take screenshot
        page.screenshot(path="verification_waveform.png")
        print("Screenshot saved to verification_waveform.png")

    except Exception as e:
        print(f"Failed to verify waveform selector: {e}")
        page.screenshot(path="verification_failure_selector.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
