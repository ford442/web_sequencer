from playwright.sync_api import sync_playwright

def verify_cloud_status():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            # Navigate to the app (assuming default vite port)
            page.goto("http://localhost:5173")

            # Wait for header to load
            page.wait_for_selector("header")

            status_indicator = page.locator("text=CLOUD").first
            status_indicator.wait_for(state="visible", timeout=10000)

            # Take a screenshot of the header area
            header = page.locator("header")
            header.screenshot(path="verification/header_status_v3.png")

            print("Screenshot taken: verification/header_status_v3.png")

        except Exception as e:
            print(f"Verification failed: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_cloud_status()
