import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "./config.js";
import type { DigestData } from "./types.js";
import { getTranslations } from "./translations.js";

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [summarize] ${msg}`);
}

function buildUserPrompt(digest: DigestData, config: Config): string {
  const t = getTranslations(config.lang);

  const viralSection = digest.virals.map((tw) => ({
    author: `@${tw.authorUsername}`,
    url: tw.url,
    text: tw.text,
    likes: tw.stats.likes,
    retweets: tw.stats.retweets,
    score: tw.score,
  }));

  const threadSection = digest.threads.map((th) => ({
    author: `@${th.authorUsername}`,
    url: th.url,
    totalTweets: th.totalTweets,
    tweets: th.tweets.map((tw) => ({ text: tw.text, url: tw.url })),
  }));

  const weakSignalSection = digest.weakSignals.map((tw) => ({
    author: `@${tw.authorUsername}`,
    url: tw.url,
    text: tw.text,
    likes: tw.stats.likes,
    retweets: tw.stats.retweets,
  }));

  return `${t.userPromptIntro(digest.date)}

## ${t.viralTweetsLabel} (${digest.virals.length})
${JSON.stringify(viralSection, null, 2)}

## ${t.threadsLabel} (${digest.threads.length})
${JSON.stringify(threadSection, null, 2)}

## ${t.weakSignalsLabel} (${digest.weakSignals.length})
${JSON.stringify(weakSignalSection, null, 2)}

${t.produceAnalysis}`;
}

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generateSummary(
  digest: DigestData,
  config: Config
): Promise<string> {
  const t = getTranslations(config.lang);

  if (digest.virals.length === 0 && digest.threads.length === 0) {
    log("No content to summarize, returning quiet day message");
    return `## \u2600\ufe0f ${t.quietDayTitle}\n\n${t.quietDayMessage}`;
  }

  log("Generating AI summary...");

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const message = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        system: t.systemPrompt,
        messages: [
          {
            role: "user",
            content: buildUserPrompt(digest, config),
          },
        ],
      });

      const text = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");

      log(`Summary generated (${text.length} chars)`);
      return text;
    } catch (err) {
      lastError = err as Error;
      const status = (err as { status?: number }).status;
      if (status === 429 || status === 529 || (status !== undefined && status >= 500)) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        log(`Anthropic API error (${status}) - retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error("generateSummary: all retries exhausted");
}
