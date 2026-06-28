import { createApp } from "./app.js";
import { config } from "./config.js";
import { startMatchingScheduler } from "./jobs/matchingJob.js";

const app = createApp();

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${config.port}`);
});

startMatchingScheduler();
