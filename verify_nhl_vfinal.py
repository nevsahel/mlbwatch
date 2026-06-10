import json
import asyncio
from playwright.async_api import async_playwright

async def run_verification():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.text}"))

        # Mocks
        scoreboard_mock = {
            "gamesByDate": [
                {
                    "date": "2024-10-22",
                    "games": [
                        {
                            "id": 2024020101,
                            "gameState": "LIVE",
                            "startTimeUTC": "2024-10-22T23:00:00Z",
                            "awayTeam": {"abbrev": {"default": "TOR"}, "score": 2},
                            "homeTeam": {"abbrev": {"default": "MTL"}, "score": 2},
                            "periodDescriptor": {"number": 3, "periodType": "REG"},
                            "clock": {"timeRemaining": "04:30", "inIntermission": False},
                            "situationCode": "1551",
                            "seriesStatusText": "Series tied 2-2"
                        }
                    ]
                }
            ]
        }
        landing_mock = {
            "awayTeam": {"abbrev": "TOR", "score": 2},
            "homeTeam": {"abbrev": "MTL", "score": 2},
            "summary": {
                "scoring": [],
                "penalties": [],
                "teamGameStats": [
                    {"category": "sog", "awayValue": "30", "homeValue": "28"},
                    {"category": "faceoffWinningPctg", "awayValue": "55.0", "homeValue": "45.0"}
                ],
                "playerByGameStats": {
                    "awayTeam": {
                        "skaters": [{"name": {"default": "Auston Matthews"}, "position": "C", "goals": 1, "assists": 1, "points": 2, "plusMinus": 1, "sog": 5, "toi": "22:00"}],
                        "goalies": [{"name": {"default": "Joseph Woll"}, "shotsAgainst": 28, "goalsAgainst": 2, "saves": 26, "savePctg": ".929"}]
                    },
                    "homeTeam": {
                        "skaters": [{"name": {"default": "Cole Caufield"}, "position": "RW", "goals": 2, "assists": 0, "points": 2, "plusMinus": 1, "sog": 6, "toi": "20:00"}],
                        "goalies": [{"name": {"default": "Sam Montembeault"}, "shotsAgainst": 30, "goalsAgainst": 2, "saves": 28, "savePctg": ".933"}]
                    }
                }
            }
        }

        async def handle_route(route):
            url = route.request.url
            if "scoreboard" in url:
                await route.fulfill(status=200, content_type="application/json", body=json.dumps(scoreboard_mock), headers={"Access-Control-Allow-Origin": "*"})
            elif "landing" in url:
                await route.fulfill(status=200, content_type="application/json", body=json.dumps(landing_mock), headers={"Access-Control-Allow-Origin": "*"})
            else:
                await route.fulfill(status=200, content_type="application/json", body="{}", headers={"Access-Control-Allow-Origin": "*"})

        # Route EVERY https request
        await page.route("https://**", handle_route)

        await page.goto("http://localhost:8000/nhl.html")
        await page.wait_for_selector("#start-btn")

        # Start and Force Date
        await page.click("#start-btn")
        await asyncio.sleep(1)
        await page.evaluate("setGameDate('2024-10-22')")

        # Wait for card
        await page.wait_for_selector(".game-card", timeout=10000)
        print("Verified: Game card found.")

        # Check series badge
        series_badge = await page.query_selector(".badge.series")
        if series_badge:
            print("Verified: Series Badge found.")

        # Open Drawer
        await page.click(".game-card")
        await page.wait_for_selector(".team-stats-box", timeout=10000)
        print("Verified: Team Comparison stats found in drawer.")

        await page.screenshot(path="nhl_revamp_final_vfinal.png")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(run_verification())
