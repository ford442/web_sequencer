from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True, args=["--no-sandbox"])
    page = browser.new_page()

    page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
    page.on("pageerror", lambda exc: print(f"PAGE ERROR: {exc}"))

    try:
        page.goto("http://localhost:5173/")
        page.wait_for_timeout(3000)

        module_exists = page.evaluate("!!window.Module")
        print(f"Module exists: {module_exists}")

    except Exception as e:
        print(f"SCRIPT ERROR: {e}")

    page.screenshot(path="/home/jules/verification/verification.png")
    browser.close()

with sync_playwright() as playwright:
    run(playwright)
