from playwright.sync_api import sync_playwright
import time

def verify_hardware_module():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            print("Navigating to app...")
            page.goto("http://localhost:3000")

            # Wait for loading
            # The start overlay might be present.
            # "INITIALIZE SYSTEM" button.

            # Check for overlay
            print("Checking for Start Overlay...")
            try:
                start_btn = page.get_by_text("INITIALIZE SYSTEM")
                if start_btn.is_visible(timeout=5000):
                    start_btn.click()
                    print("Clicked Start.")
                else:
                    print("Start button not found or not visible immediately.")
            except:
                print("Exception looking for start button (maybe already loaded?)")

            # Wait for Rack to be visible
            print("Waiting for Hardware Module...")
            # HardwareModule has title "SYNTH A // LEAD" by default
            page.wait_for_selector("text=SYNTH A // LEAD", timeout=10000)

            # Check for Knobs (ATK, DEC, etc.)
            # They are in KnobOverlay, which renders text labels.
            print("Checking for knobs...")
            page.wait_for_selector("text=ATK")
            page.wait_for_selector("text=CUTOFF")

            # Take screenshot
            print("Taking screenshot...")
            page.screenshot(path="verification_hardware.png")
            print("Screenshot saved to verification_hardware.png")

        except Exception as e:
            print(f"Verification failed: {e}")
            page.screenshot(path="verification_failed.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_hardware_module()
