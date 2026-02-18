from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            print("Navigating to app...")
            page.goto("http://localhost:5173")

            # Wait for loading
            print("Waiting for init...")
            # Ideally we wait for the button to be enabled
            page.wait_for_selector("button:has-text('INITIALIZE SYSTEM')", state="visible", timeout=60000)
            # Short wait to ensure it's clickable
            time.sleep(1)
            page.click("button:has-text('INITIALIZE SYSTEM')")

            # Wait for app to load
            print("Waiting for main UI...")
            page.wait_for_selector("text=HYPHON", timeout=30000)

            # Select Sampler Track
            # Click the track label "SMP" in the sequencer
            # The SVG text is "SMP 1" (for bank 1)
            print("Selecting Sampler track...")
            page.click("text=SMP 1")

            # Verify Sampler Panel is visible
            page.wait_for_selector("text=BASIC", timeout=5000)
            print("Sampler Panel visible.")

            # Dispatch dragover event to the panel
            print("Dispatching dragover...")
            page.evaluate("""
                const banks = document.querySelector('[aria-label="Sample Banks"]');
                if (banks) {
                    const panel = banks.closest('.flex.flex-col.h-full');
                    if (panel) {
                        const event = new DragEvent('dragover', { bubbles: true, cancelable: true });
                        panel.dispatchEvent(event);
                    } else {
                        console.error("Panel not found");
                    }
                } else {
                    console.error("Banks not found");
                }
            """)

            # Wait for overlay
            page.wait_for_selector("text=DROP AUDIO FILE", timeout=2000)
            print("Overlay appeared.")

            # Take screenshot
            page.screenshot(path="verification/dnd_overlay.png")
            print("Screenshot taken.")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    run()
