
import time
from playwright.sync_api import sync_playwright

def verify_sampler_panel():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            # Navigate to the app (assuming default Vite port)
            page.goto("http://localhost:5173")

            # Wait for the app to load
            page.wait_for_timeout(5000)

            # Click on 'Sampler' row label to select the sampler track
            # The row label for sampler is "SMP" and it's an SVG text element in the Sequencer
            # We use .first since there might be another one in the key legend or similar
            page.get_by_text("SMP").last.click()

            # Wait for the hardware module (bottom panel) to update
            page.wait_for_timeout(1000)

            # Locate the SamplerPanel section within the hardware module
            # We look for unique text elements we added/modified

            # 1. Verify 'TTS ENGINE' label
            tts_label = page.get_by_text("TTS ENGINE")
            if tts_label.is_visible():
                print("✅ TTS ENGINE label visible")
            else:
                print("❌ TTS ENGINE label NOT visible")

            # 2. Verify Bank Buttons (aria-labels)
            # We can't easily check aria-labels visually, but we can check if buttons A, B, C, D are present
            for bank in ['A', 'B', 'C', 'D']:
                btn = page.get_by_role("tab", name=f"Select Bank {bank}")
                if btn.is_visible():
                     print(f"✅ Bank {bank} button found with correct aria-label")
                else:
                     print(f"❌ Bank {bank} button NOT found or missing aria-label")

            # 3. Verify GEN button
            gen_btn = page.get_by_role("button", name="Generate speech")
            if gen_btn.is_visible():
                print("✅ GEN button found with correct aria-label")
            else:
                print("❌ GEN button NOT found or missing aria-label")

            # 4. Verify Input
            text_input = page.get_by_label("Text to speech phrase")
            if text_input.is_visible():
                print("✅ TTS Input found with correct aria-label")
            else:
                print("❌ TTS Input NOT found or missing aria-label")

            # Take a screenshot of the bottom panel area
            # We can try to clip the screenshot to the bottom part of the screen
            viewport_size = page.viewport_size
            if viewport_size:
                height = viewport_size['height']
                width = viewport_size['width']
                # Clip to bottom 320px (Hardware Module height)
                page.screenshot(
                    path="verification/sampler_panel.png",
                    clip={"x": 0, "y": height - 320, "width": width, "height": 320}
                )
                print("📸 Screenshot saved to verification/sampler_panel.png")
            else:
                page.screenshot(path="verification/sampler_panel.png")
                print("📸 Screenshot saved (full page)")

        except Exception as e:
            print(f"❌ Error: {e}")
            page.screenshot(path="verification/error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_sampler_panel()
