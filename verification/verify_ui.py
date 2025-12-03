from playwright.sync_api import sync_playwright

def verify_sequencer_ui():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use a wide viewport to ensure no clipping due to window size,
        # though the SVG viewBox change is the key
        page = browser.new_page(viewport={'width': 1200, 'height': 800})

        # Adjust URL to match your local dev server
        page.goto("http://localhost:5173/")

        # Wait for the sequencer to be visible.
        # Looking for the SVG element or a specific row label
        page.wait_for_selector("text=LEAD")

        # Take a screenshot of the sequencer area
        # We can target the sequencer container specifically or the whole page
        # The sequencer container has classes like "w-full max-w-[1000px]"
        # But targeting the SVG might be easier if we can

        # Let's verify the SVG viewBox attribute via JS evaluation or locator
        # We target the one with the larger viewbox or specific parent structure
        # The error showed the first one has the content we expect (LEAD, BASS, etc)
        svg_locator = page.locator("svg.drop-shadow-lg").first
        viewbox = svg_locator.get_attribute("viewBox")
        print(f"Current viewBox: {viewbox}")

        # Screenshot the whole page to see the layout
        page.screenshot(path="verification/sequencer_ui.png")

        browser.close()

if __name__ == "__main__":
    verify_sequencer_ui()
