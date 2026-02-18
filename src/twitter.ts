import fs from "node:fs";
import path from "node:path";
import type { Config } from "./config.js";
import type { Tweet, TwitterApiFollowingsResponse, TwitterApiSearchResponse, TwitterApiTweet } from "./types.js";

const API_BASE = "https://api.twitterapi.io/twitter/tweet/advanced_search";
const FOLLOWINGS_API = "https://api.twitterapi.io/twitter/user/followings";
const MAX_ACCOUNTS_PER_QUERY = 25;
const MAX_PAGES = 25;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [twitter] ${msg}`);
}

function computeScore(tweet: TwitterApiTweet): number {
  return tweet.likeCount + tweet.retweetCount * 3 + tweet.quoteCount * 2;
}

function mapTweet(raw: TwitterApiTweet): Tweet {
  return {
    id: raw.id,
    text: raw.text,
    createdAt: new Date(raw.createdAt),
    authorUsername: raw.author.userName,
    authorName: raw.author.name,
    authorAvatar: raw.author.profilePicture,
    isRetweet: raw.isRetweet,
    conversationId: raw.conversationId ?? raw.id,
    inReplyToId: raw.inReplyToId ?? null,
    stats: {
      likes: raw.likeCount,
      retweets: raw.retweetCount,
      replies: raw.replyCount,
      quotes: raw.quoteCount,
      views: raw.viewCount ?? 0,
    },
    score: computeScore(raw),
    url: `https://x.com/${raw.author.userName}/status/${raw.id}`,
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.status === 429 || response.status >= 500) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        log(`HTTP ${response.status} - retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
        await sleep(delay);
        continue;
      }
      return response;
    } catch (err) {
      lastError = err as Error;
      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
      log(`Request error: ${lastError.message} - retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
      await sleep(delay);
    }
  }
  throw lastError ?? new Error("fetchWithRetry: all retries exhausted");
}

function buildQuery(accounts: string[], sinceDate: string): string {
  const fromClauses = accounts.map((a) => `from:${a}`).join(" OR ");
  return `(${fromClauses}) since:${sinceDate}`;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function searchTweets(
  apiKey: string,
  query: string,
  cutoffDate: Date
): Promise<Tweet[]> {
  const tweets: Tweet[] = [];
  let cursor: string | undefined;
  let page = 0;

  while (page < MAX_PAGES) {
    const params = new URLSearchParams({
      query,
      queryType: "Latest",
    });
    if (cursor) {
      params.set("cursor", cursor);
    }

    const url = `${API_BASE}?${params.toString()}`;
    log(`Fetching page ${page + 1}... query="${query.slice(0, 80)}${query.length > 80 ? "..." : ""}"`);

    const response = await fetchWithRetry(url, {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Twitter API error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as TwitterApiSearchResponse;

    if (!data.tweets || data.tweets.length === 0) {
      log("No more tweets in response");
      break;
    }

    let hitCutoff = false;
    for (const raw of data.tweets) {
      if (raw.isRetweet) continue;

      const tweetDate = new Date(raw.createdAt);
      if (tweetDate < cutoffDate) {
        hitCutoff = true;
        break;
      }

      tweets.push(mapTweet(raw));
    }

    if (hitCutoff) {
      log("Reached cutoff date, stopping pagination");
      break;
    }

    if (!data.has_next_page || !data.next_cursor) {
      break;
    }

    cursor = data.next_cursor;
    page++;
  }

  return tweets;
}

export async function fetchFollowings(config: Config): Promise<string[]> {
  const usernames: string[] = [];
  let cursor = "";
  let page = 0;

  log(`Fetching followings for @${config.twitterUsername}...`);

  while (page < MAX_PAGES) {
    const params = new URLSearchParams({
      userName: config.twitterUsername,
      cursor,
    });

    const url = `${FOLLOWINGS_API}?${params.toString()}`;
    log(`Fetching followings page ${page + 1}...`);

    const response = await fetchWithRetry(url, {
      method: "GET",
      headers: {
        "X-API-Key": config.twitterApiKey,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Followings API error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as TwitterApiFollowingsResponse;

    if (!data.followings || data.followings.length === 0) {
      break;
    }

    for (const user of data.followings) {
      if (user.userName) {
        usernames.push(user.userName);
      }
    }

    if (!data.has_next_page || !data.next_cursor) {
      break;
    }

    cursor = data.next_cursor;
    page++;
  }

  log(`Found ${usernames.length} followed accounts`);
  const profileCost = (usernames.length * 0.18) / 1000;
  log(`Estimated cost for profiles: ~$${profileCost.toFixed(2)} (${usernames.length} profiles × $0.18/1K)`);
  return usernames;
}

const CACHE_DIR = "./cache";
const FOLLOWINGS_CACHE_FILE = path.join(CACHE_DIR, "followings.json");

interface FollowingsCache {
  timestamp: number;
  username: string;
  followings: string[];
}

export async function loadFollowingsWithCache(config: Config): Promise<string[]> {
  try {
    if (fs.existsSync(FOLLOWINGS_CACHE_FILE)) {
      const raw = fs.readFileSync(FOLLOWINGS_CACHE_FILE, "utf-8");
      const cache = JSON.parse(raw) as FollowingsCache;

      if (cache.username === config.twitterUsername) {
        const ageMs = Date.now() - cache.timestamp;
        const ageHours = ageMs / (1000 * 60 * 60);

        if (ageHours < config.followingsCacheTTL) {
          log(`Using cached followings (age: ${ageHours.toFixed(1)}h, ${cache.followings.length} accounts)`);
          return cache.followings;
        }
        log(`Followings cache expired (age: ${ageHours.toFixed(1)}h > TTL: ${config.followingsCacheTTL}h)`);
      } else {
        log(`Followings cache is for different user (@${cache.username}), refetching`);
      }
    }
  } catch {
    log("Could not read followings cache, fetching fresh data");
  }

  const followings = await fetchFollowings(config);

  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    const cache: FollowingsCache = {
      timestamp: Date.now(),
      username: config.twitterUsername,
      followings,
    };
    fs.writeFileSync(FOLLOWINGS_CACHE_FILE, JSON.stringify(cache, null, 2));
    log("Followings cache updated");
  } catch (err) {
    log(`Warning: could not write followings cache: ${err}`);
  }

  return followings;
}

export async function fetchTimeline(config: Config, followedAccounts: string[]): Promise<Tweet[]> {
  const cutoffDate = new Date(Date.now() - config.lookbackHours * 60 * 60 * 1000);
  const sinceDate = cutoffDate.toISOString().split("T")[0];

  log(`Fetching tweets since ${sinceDate} for ${followedAccounts.length} accounts`);

  const chunks = chunkArray(followedAccounts, MAX_ACCOUNTS_PER_QUERY);
  const allTweets: Tweet[] = [];

  for (const chunk of chunks) {
    const query = buildQuery(chunk, sinceDate);
    const tweets = await searchTweets(config.twitterApiKey, query, cutoffDate);
    allTweets.push(...tweets);
  }

  // Deduplicate by ID
  const seen = new Set<string>();
  const deduplicated = allTweets.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });

  log(`Fetched ${deduplicated.length} unique tweets (${allTweets.length} before dedup)`);
  const tweetCost = (deduplicated.length * 0.15) / 1000;
  log(`Estimated cost for tweets: ~$${tweetCost.toFixed(2)} (${deduplicated.length} tweets × $0.15/1K)`);
  return deduplicated;
}
