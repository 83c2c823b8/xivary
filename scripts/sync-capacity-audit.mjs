import { measureFixture } from "./fixtures/sync-capacity.mjs";

// No native storage, network, user profiles or writes. Reproducible synthetic data.
console.log(JSON.stringify({
  warning: "Compact snapshots are a capacity lower bound, not a safe sync protocol or implemented feature.",
  quotas: { bytes: 102400, perItem: 8192, items: 512 },
  measurements: [300, 500, 1000].map(measureFixture),
}, null, 2));
