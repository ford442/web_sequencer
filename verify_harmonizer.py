from playwright.sync_api import sync_playwright

def verify_harmonizer_ui():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # Capture console logs
        page.on("console", lambda msg: print(f"Browser Console: {msg.text}"))

        try:
            # Navigate to the app (Updated port 5174)
            page.goto("http://localhost:5174")

            # Wait for app to load
            page.wait_for_selector("text=HYPHON", timeout=15000)

            # Click on 'Sampler' row to open sampler panel
            # "SMP 1" might be the row label text.
            print("Clicking SMP 1...")
            page.get_by_text("SMP 1").click()

            # Wait a bit for React to update
            page.wait_for_timeout(1000)

            # Take a debug screenshot here
            page.screenshot(path="debug_after_click.png")

            # Check if Hardware Module title updated
            # The title is in the hardware module container.
            # Let's search for "SAMPLER" case insensitive or partial
            if page.locator("text=SAMPLER").count() > 0:
                print("Found 'SAMPLER' text.")
            else:
                print("Could not find 'SAMPLER' text.")

            # Wait for Sampler Panel to appear
            print("Waiting for Sampler Panel title...")
            # We look for unique text "SAMPLER // BANK 1"
            page.wait_for_selector("text=SAMPLER // BANK 1", timeout=5000)

            # Verify Harmonizer UI elements are present
            print("Checking Dropdown...")
            select = page.locator("select")
            if not select.is_visible():
                print("Error: Select dropdown not visible")
            else:
                print("Dropdown visible")

            # 2. Harmonize Button
            print("Checking Button...")
            btn = page.get_by_role("button", name="HARM")
            if not btn.is_visible():
                print("Error: Harmonize button not visible")
            else:
                print("Button visible")

            # Take screenshot
            page.screenshot(path="verification_harmonizer.png")
            print("Screenshot saved to verification_harmonizer.png")

        except Exception as e:
            print(f"Verification failed: {e}")
            page.screenshot(path="verification_error.png")

        finally:
            browser.close()

if __name__ == "__main__":
    verify_harmonizer_ui()
