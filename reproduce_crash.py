
from playwright.sync_api import sync_playwright
import time

def reproduce_crash():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Listen for console errors
        page.on("console", lambda msg: print(f"CONSOLE: {msg.text}") if msg.type == "error" else None)
        page.on("pageerror", lambda exc: print(f"PAGE ERROR: {exc}"))

        try:
            page.goto("http://localhost:5000", timeout=10000)
            page.wait_for_selector("input[type='text']")

            print("Sending query...")
            page.fill("input[type='text']", "你好") # Simple query to trigger backend
            page.click("button[type='submit']")

            # Wait for response and potential crash
            # The user says it crashes "after generation completes".
            # So we wait for some "assistant" message to appear and settle.

            # Wait for streaming to start
            page.wait_for_selector("text=Thinking", timeout=10000)
            print("Thinking started...")

            # Wait for completion (streaming done)
            # We can look for the absence of the loading spinner or presence of final text
            time.sleep(10) # Give it time to finish and crash

            # Check if page content is still visible (not white screen)
            if page.locator("body").count() == 0:
                print("CRASH DETECTED: Body is empty")
            else:
                # Check if the main app container is still there
                if page.locator("text=QueryGPT").count() > 0:
                    print("App seems alive.")
                else:
                    print("CRASH DETECTED: Main UI elements missing")

            page.screenshot(path="/home/jules/crash_report.png")

        except Exception as e:
            print(f"Script Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    reproduce_crash()
