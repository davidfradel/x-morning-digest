import { loadConfig } from "./config.js";
import { loadFollowingsWithCache, fetchTimeline } from "./twitter.js";
import { buildDigest } from "./digest.js";
import { generateSummary } from "./summarize.js";
import { sendDigestEmail, sendAlertEmail } from "./email.js";

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [main] ${msg}`);
}

async function runDigest(): Promise<void> {
  const config = loadConfig();

  log("=== Starting X Digest pipeline ===");

  // Step 1: Fetch followed accounts
  log("Step 1/5: Fetching followed accounts...");
  const followedAccounts = await loadFollowingsWithCache(config);
  log(`Following ${followedAccounts.length} accounts`);

  if (followedAccounts.length === 0) {
    throw new Error(`No followed accounts found for @${config.twitterUsername}`);
  }

  // Step 2: Fetch tweets
  log("Step 2/5: Fetching tweets...");
  const tweets = await fetchTimeline(config, followedAccounts);
  log(`Fetched ${tweets.length} tweets`);

  // Cost estimate
  const profileCost = (followedAccounts.length * 0.18) / 1000;
  const tweetCost = (tweets.length * 0.15) / 1000;
  const totalCost = profileCost + tweetCost;
  log(`Estimated API cost: ~$${totalCost.toFixed(2)} (${tweets.length} tweets × $0.15/1K + ${followedAccounts.length} profiles × $0.18/1K)`);

  // Step 3: Build digest (score, filter virals, detect threads)
  log("Step 3/5: Building digest...");
  const digest = buildDigest(tweets, config, followedAccounts.length);
  log(`Digest: ${digest.virals.length} virals, ${digest.threads.length} threads`);

  // Step 4: Generate AI summary
  log("Step 4/5: Generating AI summary...");
  const summary = await generateSummary(digest, config);
  log("Summary generated");

  // Step 5: Send email
  log("Step 5/5: Sending email...");
  await sendDigestEmail(digest, summary, config);

  log("=== X Digest pipeline complete ===");
}

async function main(): Promise<void> {
  try {
    await runDigest();
    process.exit(0);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("Pipeline error:", error.message);
    try {
      const config = loadConfig();
      await sendAlertEmail(error, config);
    } catch (alertErr) {
      console.error("Failed to send alert email:", alertErr);
    }
    process.exit(1);
  }
}

main();
