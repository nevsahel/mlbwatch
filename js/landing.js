async function updatePeeks() {
    // MLB Peek
    try {
        const today = todayET();
        const mlbData = await requestPool.fetchDedup(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${today}`, { ttl: 60000 });
        const games = mlbData.dates?.[0]?.games || [];
        const live = games.filter(g => g.status.abstractGameState === 'Live').length;
        const total = games.length;

        const el = document.getElementById('mlb-peek').querySelector('.peek-content');
        if (total > 0) {
            el.innerHTML = `${live > 0 ? `<span class="live-count">${live} LIVE</span>` : ''} <span>${total} Games Today</span>`;
        } else {
            el.textContent = "No games scheduled today";
        }
    } catch (e) {
        document.getElementById('mlb-peek').querySelector('.peek-content').textContent = "MLB Dashboard Ready";
    }

    // NHL Peek
    try {
        const today = todayET();
        const nhlData = await requestPool.fetchDedup(`https://api-web.nhle.com/v1/scoreboard/now`, { ttl: 60000 });
        let games = nhlData.games || [];
        if (games.length === 0 && nhlData.gamesByDate) {
            const todayEntry = nhlData.gamesByDate.find(d => d.date === today);
            if (todayEntry) games = todayEntry.games || [];
            else {
                // Fallback: search any games
                const anyDate = nhlData.gamesByDate.find(d => d.games?.length > 0);
                if (anyDate) games = anyDate.games;
            }
        }

        const live = games.filter(g => g.gameState === 'LIVE' || g.gameState === 'CRIT').length;
        const total = games.length;

        const el = document.getElementById('nhl-peek').querySelector('.peek-content');
        if (total > 0) {
            el.innerHTML = `${live > 0 ? `<span class="live-count">${live} LIVE</span>` : ''} <span>${total} Games Today</span>`;
        } else {
            el.textContent = "No games scheduled today";
        }
    } catch (e) {
        document.getElementById('nhl-peek').querySelector('.peek-content').textContent = "NHL Dashboard Ready";
    }
}

document.addEventListener('DOMContentLoaded', () => {
    updatePeeks();
    setInterval(updatePeeks, 60000);
});
