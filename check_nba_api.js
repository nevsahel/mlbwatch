const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function check() {
    const date = "20250115";
    const scoreboardUrl = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date}`;
    const resp = await fetch(scoreboardUrl);
    const data = await resp.json();
    if (data.events && data.events.length > 0) {
        const gameId = data.events[0].id;
        const summaryUrl = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${gameId}`;
        const sResp = await fetch(summaryUrl);
        const sData = await sResp.json();
        console.log("Game ID:", gameId);
        console.log("Has plays:", !!sData.plays);
        if (sData.plays) console.log("Play count:", sData.plays.length);
    } else {
        console.log("No games found for date");
    }
}

check();
