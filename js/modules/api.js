import { MLB_API } from '../constants.js';
import { requestPool } from '../../utils/performance.js';
import { selectedDate, todayET } from '../../app.js';

export async function fetchLiveGamesData() {
  const date = selectedDate || todayET();
  let schedData;
  try {
    schedData = await requestPool.fetchDedup(
      `${MLB_API}/schedule?sportId=1&date=${date}&hydrate=linescore,team,probablePitcher,broadcasts`,
      { cacheKey: `schedule:${date}` }
    );
  } catch (e) { return []; }
  if (!schedData.dates || schedData.dates.length === 0) return [];
  return schedData.dates[0].games;
}

