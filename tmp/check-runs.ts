import { runs } from "@trigger.dev/sdk/v3";

// Get run IDs from the most recent daily-scrape batch
const RUN_IDS = [
  "run_cmk6xwk5t2l1g2nmwcftvhtpk", // enrich-events
  "run_cmk6xrteg2ls12mn452pk047j", // scrape-luma
  "run_cmk6xrted2nlz2zlt9rky1575", // scrape-ba-tourism
  "run_cmk6xrtea2miq2tn4yfaucoio", // scrape-meetup
  "run_cmk6xrtc02oj52zmw3wwf2wft", // scrape-eventbrite
  "run_cmk6xrtc02jl82molm65qdc7g", // scrape-passline
  "run_cmk6xrpov007926of9cvrpwmw", // daily-scrape
];

async function getRunDetails() {
  console.log("Trigger.dev Run Details (Most Recent Batch):\n");

  for (const runId of RUN_IDS) {
    const run = await runs.retrieve(runId);

    console.log("═".repeat(70));
    console.log(`📋 ${run.taskIdentifier.toUpperCase()}`);
    console.log("─".repeat(70));
    console.log("  Status:", run.status);
    console.log("  Duration:", run.startedAt && run.finishedAt
      ? `${Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)}s`
      : "N/A");

    if (run.output) {
      console.log("  Output:", JSON.stringify(run.output, null, 2));
    }
    if (run.error) {
      console.log("  ❌ Error:", JSON.stringify(run.error, null, 2));
    }
    console.log("");
  }
}

getRunDetails().catch(console.error);
