from playwright.sync_api import sync_playwright

def verify_app():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            # Navigate to the app (assuming default Vite port 5173)
            page.goto("http://localhost:5173")

            # Wait for the app to load
            page.wait_for_selector("text=ELECTRIBE")

            # Verify Sampler Track exists
            print("Checking for Sampler track...")
            sampler_label = page.get_by_text("SMP")
            if sampler_label.count() > 0:
                print("Sampler track found.")
            else:
                print("Sampler track NOT found.")

            # Click on Sampler track to reveal Sampler Panel
            sampler_label.click()

            # Verify Live Keyboard is present
            print("Checking for Live Keyboard...")
            # Look for the keyboard SVG or specific text (notes)
            if page.locator("text=C4").count() > 0:
                 print("Live Keyboard (C4) found.")

            # Take a full page screenshot
            page.screenshot(path="verification/screenshot_full.png", full_page=True)
            print("Screenshot saved to verification/screenshot_full.png")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_app()
