from playwright.sync_api import sync_playwright, expect

def test_note_selector(page):
    print("Navigating to app...")
    page.goto("http://localhost:5173")

    print("Waiting for initialization...")
    init_btn = page.get_by_role("button", name="INITIALIZE SYSTEM")
    init_btn.wait_for(state="visible", timeout=60000)

    print("Clicking initialize...")
    init_btn.click()

    expect(init_btn).not_to_be_visible(timeout=10000)
    print("System initialized.")

    print("Finding step...")
    step = page.get_by_role("button", name="Lead step 1", exact=True)
    step.wait_for(state="visible")

    print("Simulating right click sequence...")
    box = step.bounding_box()
    x = box["x"] + box["width"] / 2
    y = box["y"] + box["height"] / 2

    page.mouse.move(x, y)
    step.dispatch_event("pointerdown", {
        "button": 2,
        "buttons": 2,
        "clientX": x,
        "clientY": y,
        "bubbles": True,
        "pointerId": 1,
        "pointerType": "mouse"
    })
    page.wait_for_timeout(100)
    page.mouse.up(button="right")

    print("Verifying dialog...")
    # There might be 2 due to App.tsx duplication, so we pick first
    dialog = page.get_by_role("dialog", name="NOTE PROPERTIES").first
    expect(dialog).to_be_visible()

    page.screenshot(path="verification/note_selector_open.png")
    print("Screenshot 1 taken.")

    print("Clicking outside...")
    page.mouse.click(10, 10)

    print("Verifying dialog closed...")
    expect(dialog).not_to_be_visible()

    page.screenshot(path="verification/note_selector_closed.png")
    print("Screenshot 2 taken.")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_note_selector(page)
            print("Verification script finished successfully.")
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")
        finally:
            browser.close()
