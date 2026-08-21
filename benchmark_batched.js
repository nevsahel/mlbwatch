async function fetchPlayerHeatNBA(playerId, statKey) {
  const heat = [];
  for (let i = 0; i < 10; i++) {
    heat.push(Math.random() > 0.5 ? 1 : 0);
  }
  await new Promise(r => setTimeout(r, 10)); // Simulated 10ms network delay
  return heat;
}

async function fetchPlayersHeatNBA(playerIds) {
  const heats = {};
  for (const id of playerIds) {
    const heat = [];
    for (let i = 0; i < 10; i++) {
      heat.push(Math.random() > 0.5 ? 1 : 0);
    }
    heats[id] = heat;
  }
  await new Promise(r => setTimeout(r, 10)); // Simulated 10ms network delay for single batched request
  return heats;
}

const allMilestones = Array.from({length: 50}).map((_, i) => ({id: i, stat: "PTS"}));

async function runOriginal() {
  const s = performance.now();
  const CONCURRENCY_LIMIT = 5;
  let heatIndex = 0;
  const worker = async () => {
    while (heatIndex < allMilestones.length) {
      const m = allMilestones[heatIndex++];
      try {
        m.heat = await fetchPlayerHeatNBA(m.id, m.stat);
      } catch (e) {
        m.heat = [];
      }
    }
  };
  const workers = Array.from(
    { length: Math.min(CONCURRENCY_LIMIT, allMilestones.length) },
    worker
  );
  await Promise.all(workers);
  console.log(`Original worker loop time (N requests): ${(performance.now() - s).toFixed(2)}ms`);
}

async function runParallel() {
  const s = performance.now();
  await Promise.all(allMilestones.map(async m => {
    try {
      m.heat = await fetchPlayerHeatNBA(m.id, m.stat);
    } catch (e) {
      m.heat = [];
    }
  }));
  console.log(`Unbounded Promise.all time (N requests): ${(performance.now() - s).toFixed(2)}ms`);
}

async function runBatched() {
  const s = performance.now();
  try {
    const playerIds = allMilestones.map(m => m.id);
    const heats = await fetchPlayersHeatNBA(playerIds);
    allMilestones.forEach(m => {
      m.heat = heats[m.id] || [];
    });
  } catch (e) {
    allMilestones.forEach(m => m.heat = []);
  }
  console.log(`Batched request time (1 request): ${(performance.now() - s).toFixed(2)}ms`);
}

async function run() {
  await runOriginal();
  await runParallel();
  await runBatched();
}
run();
