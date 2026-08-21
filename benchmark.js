async function fetchPlayerHeatNBA(playerId, statKey) {
  const heat = [];
  for (let i = 0; i < 10; i++) {
    heat.push(Math.random() > 0.5 ? 1 : 0);
  }
  // Simulate network delay
  await new Promise(r => setTimeout(r, 10));
  return heat;
}

const allMilestones = Array.from({length: 50}).map((_, i) => ({id: i, stat: "PTS"}));

async function runBaseline() {
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
  console.log(`Baseline time: ${(performance.now() - s).toFixed(2)}ms`);
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
  console.log(`Parallel time: ${(performance.now() - s).toFixed(2)}ms`);
}

async function run() {
  await runBaseline();
  await runParallel();
}
run();
