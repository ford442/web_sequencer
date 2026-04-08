import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1920, "height": 1080})

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
        # Wait for SamplerPanel to load
        await page.wait_for_timeout(2000)

        # Take a screenshot of the panel itself
        sampler_panel = page.locator(".bg-slate-900.rounded-xl.border").first
        await sampler_panel.screenshot(path="/home/jules/verification/sampler_panel_only.png")

        print("Checking if Trem Rate and Trem Depth exist...")
        # Check text exists
        content = await page.content()
        if "Trem Rate" in content and "Trem Depth" in content:
            print("SUCCESS: Tremolo controls found in DOM!")
        else:
            print("ERROR: Tremolo controls not found in DOM.")

        await browser.close()

asyncio.run(main())
