#!/usr/bin/env python
"""Capture light + dark screenshots of a route of the running app.

Black-box helper for the design-pass loop. Assumes a dev server is ALREADY
reachable at --base (use scripts/capture.sh, which handles reuse-or-boot and
fails fast). Saves to design/screenshots/ by default.

Examples:
    python shoot.py --name baseline-list                 # route "/", both themes
    python shoot.py --path "/?folder=foo" --name scoped  # a scoped view

Run with --help for all options. Notes:
- next-themes stores the theme in localStorage key 'theme'; dark is set via an
  init script before navigation.
- We do NOT wait for networkidle: Next dev keeps an HMR websocket open so it
  never settles. We wait for real content, then a short settle.
- The first hit to a route triggers Next dev's on-demand compile, so navigation
  is retried a few times before giving up.
"""
import argparse
import sys
from playwright.sync_api import sync_playwright


def goto_with_retry(page, url, attempts=4):
    last = None
    for _ in range(attempts):
        try:
            page.goto(url, wait_until="load", timeout=45000)
            return
        except Exception as e:  # cold compile / transient dev-server hiccup
            last = e
            page.wait_for_timeout(1500)
    raise last


def capture(browser, base, path, name, out, width, height, full, theme):
    ctx = browser.new_context(
        viewport={"width": width, "height": height},
        color_scheme=theme,
    )
    if theme == "dark":
        ctx.add_init_script("localStorage.setItem('theme','dark')")
    page = ctx.new_page()
    goto_with_retry(page, base + path)
    # Wait for real content (table or empty-state) rather than networkidle.
    for sel in ("table", ".border-dashed"):
        try:
            page.wait_for_selector(sel, timeout=12000)
            break
        except Exception:
            continue
    page.wait_for_timeout(600)  # let fonts/animations settle
    dest = f"{out}/{name}-{theme}.png"
    page.screenshot(path=dest, full_page=full)
    print("wrote", dest)
    ctx.close()


def main():
    ap = argparse.ArgumentParser(description="Screenshot a route in light + dark.")
    ap.add_argument("--base", default="http://localhost:3000")
    ap.add_argument("--path", default="/", help="route to capture, e.g. /?folder=x")
    ap.add_argument("--name", required=True, help="basename, e.g. phase3-sidebar")
    ap.add_argument("--out", default="design/screenshots")
    ap.add_argument("--width", type=int, default=1440)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--themes", default="light,dark", help="comma list: light,dark")
    ap.add_argument("--no-full", action="store_true", help="viewport only, not full page")
    args = ap.parse_args()

    themes = [t.strip() for t in args.themes.split(",") if t.strip()]
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            for theme in themes:
                capture(
                    browser, args.base, args.path, args.name, args.out,
                    args.width, args.height, not args.no_full, theme,
                )
        finally:
            browser.close()
    print("DONE")


if __name__ == "__main__":
    sys.exit(main())
