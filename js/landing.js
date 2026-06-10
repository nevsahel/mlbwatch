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
}

document.addEventListener('DOMContentLoaded', () => {
    updatePeeks();
    setInterval(updatePeeks, 60000);
});
