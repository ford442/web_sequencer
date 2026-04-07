from playwright.sync_api import sync_playwright
import time

def test_pattern_selector(page):
    # Go to app
    page.goto("http://localhost:5173")

    # Wait for the StartOverlay to disappear (or click "CONTINUE TO WORKSTATION")
    print("Waiting for Pyodide to load...")
    try:
        # The button "INITIALIZE SYSTEM" appears when pyodide is loaded
        init_btn = page.get_by_role("button", name="INITIALIZE SYSTEM")
        init_btn.wait_for(timeout=90000)
        init_btn.click()
        page.wait_for_timeout(1000)
    except Exception as e:
        print("Could not find INITIALIZE SYSTEM button")

    try:
        start_btn = page.get_by_role("button", name="CONTINUE TO WORKSTATION")
        if start_btn.is_visible(timeout=5000):
            start_btn.click()
            page.wait_for_timeout(1000)
    except:
        pass

    # Give it a second to load everything
    page.wait_for_timeout(2000)

    # Click the SONG ARRANGER button - it has text "SONG" in the header!
    # Ah, the button in header is named SONG
    song_btn = page.get_by_role("button", name="Toggle Song Mode")
    if song_btn.is_visible():
        song_btn.click()
        page.wait_for_timeout(1000)

    print("Opening Pattern Selector...")
    # Double right-click the first cell of partA
    cell = page.locator("[data-testid='cell-partA-0']")
    if cell.is_visible():
        cell.click(button="right")
        page.wait_for_timeout(50)
        cell.click(button="right")

    page.wait_for_timeout(1000)

    page.keyboard.press("Tab")
    page.keyboard.press("Tab")
    page.keyboard.press("Tab")
    page.keyboard.press("Tab")
    page.keyboard.press("Tab")
    page.keyboard.press("Tab")
    page.keyboard.press("Tab")
    page.keyboard.press("Tab")

    page.wait_for_timeout(500)
    page.keyboard.press("ArrowRight")
    page.keyboard.press("ArrowRight")

    page.wait_for_timeout(500)

    # Take screenshot of the Pattern Selector
    page.screenshot(path="verification_pattern_selector.png", clip={"x": 100, "y": 100, "width": 500, "height": 500})
    print("Saved screenshot")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_pattern_selector(page)
        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()
