import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        # very tall viewport
        page = await browser.new_page(viewport={"width": 1920, "height": 3000})

        print("Navigating to http://localhost:5173/")
        await page.goto("http://localhost:5173/")

        # Wait for INITIALIZE SYSTEM button and click it
        print("Waiting for initialization...")
        init_btn = page.locator("button:has-text('INITIALIZE SYSTEM')")
        await init_btn.wait_for(state="visible", timeout=90000)
        await init_btn.click()

        # Click SMP 1 track
        print("Selecting SMP 1 track...")
        smp1_track = page.locator("g[aria-label='Select SMP 1 track']")
        await smp1_track.wait_for(state="visible", timeout=30000)
        await smp1_track.click()

        print("Looking for Tremolo knobs...")
        await page.wait_for_timeout(2000)

        print("Checking if Trem Rate and Trem Depth exist...")
        content = await page.content()
        if "Trem Rate" in content and "Trem Depth" in content:
            print("SUCCESS: Tremolo controls found in DOM!")
        else:
            print("ERROR: Tremolo controls not found in DOM.")

        await page.screenshot(path="/home/jules/verification/tall_screenshot.png", full_page=True)
        await browser.close()

asyncio.run(main())
