
import asyncio
from playwright.async_api import async_playwright, expect

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Navigate to the app (assuming it's running on port 5174 based on context memory,
        # but standard Vite is 5173. I'll try 5173 first, then 5174 if needed)
        try:
            await page.goto("http://localhost:5173", timeout=10000)
        except:
            print("Retrying on port 5174...")
            await page.goto("http://localhost:5174", timeout=10000)

        # Wait for app to load
        # Look for the waveform selector or some key element
        # We updated WaveformSelector to include "WAV" options.

        # Wait for the "SAW" button to be visible (existing one)
        await expect(page.get_by_text("SAW").first).to_be_visible()

        # Check for the new WAV buttons
        # The text inside the SVG is "WAV"

        # We can look for the button with label "Select wav-saw waveform"
        wav_saw_btn = page.locator('button[aria-label="Select wav-saw waveform"]')
        await expect(wav_saw_btn).to_be_visible()

        wav_sqr_btn = page.locator('button[aria-label="Select wav-sqr waveform"]')
        await expect(wav_sqr_btn).to_be_visible()

        # Take a screenshot of the waveform selector area
        # We can screenshot the whole page or just the selector
        await page.screenshot(path="verification/waveform_selector.png")

        print("Verification screenshot taken at verification/waveform_selector.png")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
