#!/usr/bin/env python3
"""Usage: python webapp_smoke.py http://127.0.0.1:5173 screenshot.png"""
import argparse
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument("url")
parser.add_argument("screenshot", nargs="?", default="smoke.png")
a = parser.parse_args()
u = urlsplit(a.url)
if u.scheme not in ("http", "https") or not u.hostname:
    parser.error("Use an http(s) URL you are authorized to test")
errors = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    try:
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        response = page.goto(a.url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_load_state("networkidle", timeout=10000)
        Path(a.screenshot).parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=a.screenshot, full_page=True)
        print("STATUS:", response.status if response else "none")
        print("TITLE:", page.title())
        print("SCREENSHOT:", a.screenshot)
        print("JS_ERRORS:", errors)
        if errors or (response and response.status >= 400):
            raise SystemExit(1)
    finally:
        browser.close()

