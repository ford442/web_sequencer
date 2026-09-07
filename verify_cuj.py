from playwright.sync_api import sync_playwright

def run_cuj(page):
    page.goto("http://localhost:5173")
    page.wait_for_timeout(3000)

    # Dismiss the welcome overlay if present
    try:
        page.evaluate("document.querySelector('[data-testid=\"start-overlay\"]').remove()")
    except:
        pass

    try:
        page.evaluate("document.querySelector('vite-error-overlay').remove()")
    except:
        pass

    page.wait_for_timeout(1000)

    try:
        page.get_by_role("button", name="Close Help").click()
    except:
        pass

    page.wait_for_timeout(1000)

    # 1. Open Export Modal
    try:
        page.get_by_role("button", name="Export", exact=False).first.click(force=True)
    except:
        page.evaluate("document.querySelectorAll('button').forEach(b => { if(b.textContent.includes('Export')) b.click() })")
    page.wait_for_timeout(1000)

    page.screenshot(path="verification.png")
    page.wait_for_timeout(1000)

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            record_video_dir="videos"
        )
        page = context.new_page()
        try:
            run_cuj(page)
        finally:
            context.close()
            browser.close()
