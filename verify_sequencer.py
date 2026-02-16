from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            print("Navigating to app on port 4173...")
            page.goto("http://localhost:4173")

            # Wait for overlay button to be enabled/clickable
            print("Waiting for initialize button...")
            # The button text changes from LOADING RESOURCES... to INITIALIZE SYSTEM
            page.wait_for_selector("button:has-text('INITIALIZE SYSTEM')", timeout=30000)

            # Click initialize
            print("Clicking initialize...")
            page.click("button:has-text('INITIALIZE SYSTEM')")

            # Wait for main UI (sequencer steps)
            print("Waiting for main UI...")
            # The step selector class is .svg-step
            page.wait_for_selector(".svg-step", timeout=10000)

            # Click a step (e.g. first step of Lead)
            print("Clicking a step...")
            # We can use a CSS selector for the first step
            steps = page.locator(".svg-step")
            count = steps.count()
            print(f"Found {count} steps")

            if count > 0:
                # Click the first step (index 0)
                steps.first.click()
                print("Clicked first step.")
                time.sleep(0.5) # Wait for update

                # Take screenshot
                print("Taking screenshot...")
                page.screenshot(path="verification_sequencer.png")
                print("Screenshot saved to verification_sequencer.png")
            else:
                print("No steps found!")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    run()
