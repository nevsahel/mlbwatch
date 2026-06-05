import asyncio
from playwright.async_api import async_playwright

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        # Load app
        await page.goto('http://localhost:3000')

        # Inject a reached milestone into localStorage
        await page.evaluate("""
            const mockReached = [{
                id: 545361,
                name: 'Mike Trout',
                team: 'LAA',
                stat: 'Career HR',
                next: 400,
                current: 400,
                progress: 100,
                paceText: 'Completed',
                timestamp: Date.now()
            }];
            localStorage.setItem('reachedMilestones', JSON.stringify(mockReached));
        """)

        # Reload to pick up the change
        await page.reload()
        await page.wait_for_selector('.tab-btn[onclick*="milestones"]')
        await page.click('.tab-btn[onclick*="milestones"]')

        # Click Achievements filter
        await page.wait_for_selector('button:has-text("Achievements")')
        await page.click('button:has-text("Achievements")')

        # Check if card is rendered
        await asyncio.sleep(1)
        await page.screenshot(path='achievements_filter_v2.png')

        cards = await page.query_selector_all('.milestone-card')
        print(f"Found {len(cards)} cards in Achievements filter")

        if len(cards) > 0:
            text = await cards[0].inner_text()
            print(f"Card text: {text[:100]}...")
            if 'Reached!' in text:
                print("SUCCESS: 'Reached!' label found")
            else:
                print("FAILURE: 'Reached!' label NOT found")
        else:
            print("FAILURE: No cards found in Achievements filter")

        await browser.close()

if __name__ == '__main__':
    asyncio.run(run())
