from playwright.sync_api import sync_playwright, expect

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("http://localhost:4173")

        # 1. Initialize System (wait for overlay to disappear)
        # The button text is "INITIALIZE SYSTEM" or "LOADING..."
        # We wait for it to become enabled and click it

        # It might be "LOADING RESOURCES..." first
        start_btn = page.get_by_role("button", name="INITIALIZE SYSTEM")
        # Increase timeout as WASM load might be slow
        try:
            start_btn.wait_for(state="visible", timeout=60000)
            if start_btn.is_disabled():
               # Wait for it to be enabled (aria-busy to be false)
               page.wait_for_function("document.querySelector('button[aria-busy=\"false\"]')")

            start_btn.click()
            # Wait for overlay to detach
            start_btn.wait_for(state="detached", timeout=10000)
        except Exception as e:
            print(f"Startup warning: {e}")
            # If we fail here, we might still be able to find the shortcuts button if the overlay is gone or non-modal?
            # But the overlay is modal (z-50).
            pass

        # 2. Click Keyboard Shortcuts button
        # It has aria-label="Keyboard Shortcuts"
        shortcuts_btn = page.get_by_label("Keyboard Shortcuts")
        expect(shortcuts_btn).to_be_visible()
        shortcuts_btn.click()

        # 3. Verify Modal
        modal = page.get_by_role("dialog", name="KEYBOARD SHORTCUTS")
        expect(modal).to_be_visible()
        expect(page.get_by_text("Sequencer Grid")).to_be_visible()

        # 4. Screenshot
        page.screenshot(path="verification/shortcuts_modal.png")
        browser.close()

if __name__ == "__main__":
    run()
