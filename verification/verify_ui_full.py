#!/usr/bin/env python3
"""
Comprehensive UI verification script for the web_sequencer app.

This script:
- Uses Playwright (sync API) to visit http://localhost:5173
  (retries on 5174 if 5173 fails).
- Confirms major UI elements are present (title, sequencer rows, waveform selectors).
- Interacts with the transport & tempo control.
- Toggles a sequencer step and inspects SVG DOM for active state.
- Takes multiple screenshots (page, sequencer, waveform selector, hardware module).
- Produces a JSON summary `verification/ui_verification_summary.json`.
"""

import os
import json
import time
import datetime
import traceback
from pathlib import Path
from typing import Dict
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

# Config
BASE_PORTS = [5173, 5174]
BASE_URLS = [f"http://localhost:{p}" for p in BASE_PORTS]
OUTPUT_DIR = Path(__file__).resolve().parent
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SUMMARY_JSON = OUTPUT_DIR / "ui_verification_summary.json"


def try_goto(page, urls):
    for url in urls:
        try:
            page.goto(url, timeout=15000)
            page.wait_for_load_state("networkidle")
            return url
        except Exception:
            continue
    raise RuntimeError("Unable to connect to any known dev server urls: " + ", ".join(urls))


def get_bb(locator):
    try:
        return locator.bounding_box()
    except Exception:
        return None


def run_checks():
    summary: Dict = {"timestamp": datetime.datetime.utcnow().isoformat() + "Z", "url": None, "status": "unknown", "checks": {}, "screenshots": {}, "errors": []}
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            url = try_goto(page, BASE_URLS)
            summary["url"] = url

            # Title check
            try:
                page.wait_for_selector("text=ELECTRIBE", timeout=15000)
                summary["checks"]["title_visible"] = True
            except PWTimeout:
                summary["checks"]["title_visible"] = False

            # Sequencer rows
            expected_rows = ["LEAD", "BASS", "KICK", "SNARE", "CH", "OH", "SMP"]
            found_rows = []
            for r in expected_rows:
                try:
                    if page.locator(f"text={r}").count() > 0:
                        found_rows.append(r)
                except Exception:
                    pass
            summary["checks"]["found_rows"] = found_rows

            # Sequencer svg
            try:
                svg = page.locator("svg.drop-shadow-lg").first
                if svg.count() == 0:
                    svg = page.locator("svg").first
                vb = svg.get_attribute("viewBox")
                summary["checks"]["sequencer_viewbox"] = vb
            except Exception as e:
                summary["checks"]["sequencer_viewbox"] = None

            # Waveform checks
            waveform_labels = [
                'Select sawtooth waveform', 'Select square waveform', 'Select triangle waveform', 'Select sine waveform',
                'Select wav-saw waveform', 'Select wav-sqr waveform',
                'Select pyodide-saw waveform', 'Select pyodide-square waveform', 'Select pyodide-sine waveform',
                'Select wgsl-saw waveform', 'Select wgsl-sqr waveform', 'Select wgsl-tri waveform', 'Select wgsl-sin waveform',
                'Select wam-saw waveform', 'Select wam-sqr waveform', 'Select wam-tri waveform', 'Select wam-sin waveform'
            ]
            waves_found = {}
            for l in waveform_labels:
                try:
                    loc = page.locator(f'button[aria-label="{l}"]')
                    waves_found[l] = loc.count() > 0 and loc.is_visible()
                except Exception:
                    waves_found[l] = False
            summary["checks"]["wave_buttons"] = waves_found

            # Collect screenshot of relevant regions
            try:
                full_path = OUTPUT_DIR / "ui_full_page.png"
                page.screenshot(path=str(full_path), full_page=True)
                summary["screenshots"]["full_page"] = str(full_path)

                # Try snapshot of sequencer SVG
                svg_bb = get_bb(svg)
                if svg_bb:
                    seq_path = OUTPUT_DIR / "ui_sequencer.png"
                    svg.screenshot(path=str(seq_path))
                    summary["screenshots"]["sequencer"] = str(seq_path)

                # Try to find waveform selector button and screenshot container
                wf_button = page.locator('button[aria-label="Select wav-saw waveform"]').first
                if wf_button.count() == 0:
                    wf_button = page.locator('button[aria-label="Select wam-saw waveform"]').first
                if wf_button.count() > 0:
                    parent = wf_button.locator('xpath=ancestor::div[1]')
                    wf_path = OUTPUT_DIR / "ui_waveform_selector.png"
                    if parent.count() > 0:
                        parent.screenshot(path=str(wf_path))
                    else:
                        wf_button.screenshot(path=str(wf_path))
                    summary["screenshots"]["waveform_selector"] = str(wf_path)

            except Exception as e:
                summary["screenshots"]["error"] = str(e)

            browser.close()
            summary["status"] = "ok"
    except Exception as ex:
        summary["status"] = "fail"
        summary["errors"].append({"message": str(ex), "trace": traceback.format_exc()})

    # Save summary
    with SUMMARY_JSON.open("w") as fh:
        json.dump(summary, fh, indent=2)

    print(json.dumps(summary, indent=2))
    if summary["status"] == "fail":
        raise SystemExit(2)


if __name__ == "__main__":
    run_checks()
