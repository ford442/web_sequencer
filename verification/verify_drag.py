from playwright.sync_api import sync_playwright
import time

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto("http://localhost:5173")

    # Wait for the app to load
    page.wait_for_selector("text=HYPHON", timeout=30000)

    # Check if we are stuck on loading
    if page.is_visible("text=LOADING RESOURCES..."):
        print("Waiting for resources...")
        # In headless, sometimes resources take time or fail silently if no audio device
        # We'll wait a bit more
        page.wait_for_selector("button:has-text('INITIALIZE SYSTEM')", timeout=60000)

    # Click START to initialize audio (dismiss overlay)
    page.click("button:has-text('INITIALIZE SYSTEM')")

    # Wait for grid
    page.wait_for_selector(".svg-step", state="visible")

    # Locate a step to drag (e.g. first step of lead synth)
    # Right click to start drag
    step = page.locator(".svg-step").first
    box = step.bounding_box()

    if box:
        # Move to center of step
        cx = box["x"] + box["width"] / 2
        cy = box["y"] + box["height"] / 2

        page.mouse.move(cx, cy)
        # Right click down
        page.mouse.down(button="right")
        # Drag up significantly (50px = 5 semitones)
        page.mouse.move(cx, cy - 50, steps=10)
        # Right click up
        page.mouse.up(button="right")

    # Take screenshot of the grid after drag
    page.screenshot(path="verification/drag_result.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
