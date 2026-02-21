import type { Config } from "./config.js";
import type { DigestData, Thread, Tweet } from "./types.js";

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [digest] ${msg}`);
}

const THREAD_MARKERS = /(?:^|\s)(\d+\/|\d+\))|🧵|thread/i;
const MAX_THREAD_TWEETS_DISPLAYED = 10;

export function scoreAndFilterVirals(tweets: Tweet[], config: Config): Tweet[] {
  const virals = tweets
    .filter((t) => t.score >= config.viralThreshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, config.topNViral);

  log(`Found ${virals.length} viral tweets (threshold: ${config.viralThreshold}, top ${config.topNViral})`);
  return virals;
}

export function detectThreads(tweets: Tweet[], config: Config): Thread[] {
  // Group tweets by conversationId
  const conversationGroups = new Map<string, Tweet[]>();
  for (const tweet of tweets) {
    const key = tweet.conversationId;
    const existing = conversationGroups.get(key);
    if (existing) {
      existing.push(tweet);
    } else {
      conversationGroups.set(key, [tweet]);
    }
  }

  const threads: Thread[] = [];
  const threadScores = new Map<Thread, number>();

  for (const [, group] of conversationGroups) {
    // A thread needs 2+ tweets from the same author in the same conversation
    const byAuthor = new Map<string, Tweet[]>();
    for (const tweet of group) {
      const existing = byAuthor.get(tweet.authorUsername);
      if (existing) {
        existing.push(tweet);
      } else {
        byAuthor.set(tweet.authorUsername, [tweet]);
      }
    }

    for (const [author, authorTweets] of byAuthor) {
      const isThread =
        authorTweets.length >= 2 ||
        authorTweets.some((t) => THREAD_MARKERS.test(t.text));

      if (!isThread) continue;

      const sorted = authorTweets.sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
      );

      // Score from ALL tweets before slicing for display
      const engagementScore = sorted.reduce((sum, tw) => sum + tw.score, 0);

      const displayedTweets = sorted.slice(0, MAX_THREAD_TWEETS_DISPLAYED);

      const thread: Thread = {
        authorUsername: author,
        authorName: sorted[0].authorName,
        authorAvatar: sorted[0].authorAvatar,
        tweets: displayedTweets,
        totalTweets: sorted.length,
        firstTweet: sorted[0],
        url: sorted[0].url,
      };

      threads.push(thread);
      threadScores.set(thread, engagementScore);
    }
  }

  threads.sort((a, b) => (threadScores.get(b) ?? 0) - (threadScores.get(a) ?? 0));
  const topThreads = threads.slice(0, config.topNThreads);
  log(`Detected ${threads.length} threads, keeping top ${topThreads.length}`);
  return topThreads;
}

export function buildDigest(tweets: Tweet[], config: Config, accountsChecked: number): DigestData {
  const virals = scoreAndFilterVirals(tweets, config);
  const threads = detectThreads(tweets, config);

  // Remove viral tweets that are already part of a thread (avoid duplication)
  const threadTweetIds = new Set(threads.flatMap((t) => t.tweets.map((tw) => tw.id)));
  const filteredVirals = virals.filter((v) => !threadTweetIds.has(v.id));

  // Compute weak signals: tweets not in virals or threads, with some engagement
  const viralIds = new Set(filteredVirals.map((v) => v.id));
  const excludedIds = new Set([...viralIds, ...threadTweetIds]);
  const weakSignals = tweets
    .filter((t) => !excludedIds.has(t.id) && t.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, config.topNWeakSignals);

  const today = new Date().toISOString().split("T")[0];

  log(
    `Digest built: ${filteredVirals.length} virals, ${threads.length} threads, ${weakSignals.length} weak signals, ${tweets.length} total tweets`
  );

  return {
    date: today,
    virals: filteredVirals,
    threads,
    weakSignals,
    totalTweetsFetched: tweets.length,
    accountsChecked,
  };
}
