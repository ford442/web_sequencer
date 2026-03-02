from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.on("console", lambda msg: print(f"Browser console: {msg.text}"))
        page.goto("http://localhost:5173")
        page.wait_for_timeout(5000)
        page.screenshot(path="verification_start.png")
        print("Took start screenshot")

        browser.close()

if __name__ == "__main__":
    run()
