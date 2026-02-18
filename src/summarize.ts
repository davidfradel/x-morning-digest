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
    text: tw.text,
    likes: tw.stats.likes,
    retweets: tw.stats.retweets,
    score: tw.score,
  }));

  const threadSection = digest.threads.map((th) => ({
    author: `@${th.authorUsername}`,
    totalTweets: th.totalTweets,
    tweets: th.tweets.map((tw) => tw.text),
  }));

  return `${t.userPromptIntro(digest.date)}

## ${t.viralTweetsLabel} (${digest.virals.length})
${JSON.stringify(viralSection, null, 2)}

## ${t.threadsLabel} (${digest.threads.length})
${JSON.stringify(threadSection, null, 2)}

${t.produceAnalysis}`;
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
}
