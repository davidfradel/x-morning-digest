import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { Config } from "../src/config.js";
import type { TwitterApiSearchResponse, TwitterApiTweet } from "../src/types.js";
import { fetchTimeline, fetchWithRetry } from "../src/twitter.js";

const SEARCH_URL = "https://api.twitterapi.io/twitter/tweet/advanced_search?query=from%3Asomeone";

// Body twitterapi.io actually returned with its 503s on 2026-11-21.
const UPSTREAM_503_BODY = JSON.stringify({
  detail: "This search couldn't be completed right now. Please retry in a few seconds. You were not charged.",
});

const config: Config = {
  twitterApiKey: "test-key",
  twitterUsername: "someone",
  anthropicApiKey: "test-key",
  resendApiKey: "test-key",
  emailFrom: "digest@example.com",
  emailTo: "reader@example.com",
  lookbackHours: 24,
  viralThreshold: 100,
  topNViral: 5,
  topNThreads: 5,
  topNWeakSignals: 15,
  lang: "en",
  followingsCacheTTL: 24,
};

// 30 accounts = two search queries (25 + 5), like the two queries of the prod run.
const accounts = Array.from({ length: 30 }, (_, i) => `account${i}`);

function unavailable(): Response {
  return new Response(UPSTREAM_503_BODY, { status: 503 });
}

function searchResult(tweets: TwitterApiTweet[]): Response {
  const body: TwitterApiSearchResponse = { tweets, has_next_page: false, next_cursor: "" };
  return new Response(JSON.stringify(body), { status: 200 });
}

/** Twitter's createdAt format, e.g. "Sat Nov 21 11:08:48 +0000 2026". */
function twitterDate(date: Date): string {
  const [weekday, day, month, year, time] = date.toUTCString().replace(",", "").split(" ");
  return `${weekday} ${month} ${day} ${time} +0000 ${year}`;
}

function tweet(id: string, hoursAgo: number): TwitterApiTweet {
  return {
    id,
    text: `tweet ${id}`,
    createdAt: twitterDate(new Date(Date.now() - hoursAgo * 60 * 60 * 1000)),
    author: {
      id: "42",
      userName: "account0",
      name: "Account Zero",
      profilePicture: "https://pbs.twimg.com/profile_images/42/avatar.jpg",
      isVerified: false,
    },
    isRetweet: false,
    inReplyToId: null,
    conversationId: id,
    likeCount: 10,
    retweetCount: 1,
    replyCount: 1,
    quoteCount: 0,
    viewCount: 388,
  };
}

/** Answers each fetch call with the next response; the last one repeats forever. */
function stubFetch(...responses: Array<() => Response>): void {
  let call = 0;
  mock.method(globalThis, "fetch", async () => {
    const next = responses[Math.min(call, responses.length - 1)];
    call++;
    return next();
  });
}

beforeEach(() => {
  mock.method(console, "log", () => {});
});

afterEach(() => {
  mock.restoreAll();
});

describe("fetchWithRetry", () => {
  it("reports the HTTP status and the upstream body when the API never recovers", async () => {
    stubFetch(unavailable);

    await assert.rejects(
      fetchWithRetry(SEARCH_URL, {}, { baseDelayMs: 1 }),
      (err: Error) => {
        assert.match(err.message, /503/);
        assert.match(err.message, /couldn't be completed right now/);
        return true;
      }
    );
  });

  it("survives three consecutive 503s, the streak that killed the 2026-11-21 run", async () => {
    stubFetch(unavailable, unavailable, unavailable, () => searchResult([tweet("1", 2)]));

    const response = await fetchWithRetry(SEARCH_URL, {}, { baseDelayMs: 1 });

    assert.equal(response.status, 200);
    const data = (await response.json()) as TwitterApiSearchResponse;
    assert.equal(data.tweets[0].id, "1");
  });
});

describe("fetchTimeline", () => {
  it("fails instead of reporting a quiet day when every search comes back empty", async () => {
    stubFetch(() => searchResult([]));

    await assert.rejects(fetchTimeline(config, accounts), /30 accounts/);
  });

  it("returns no tweets, without failing, when the API only has tweets older than the lookback window", async () => {
    stubFetch(() => searchResult([tweet("1", 30)]));

    const tweets = await fetchTimeline(config, accounts);

    assert.deepEqual(tweets, []);
  });

  it("returns the tweets posted inside the lookback window", async () => {
    stubFetch(
      () => searchResult([tweet("1", 2), tweet("2", 30)]),
      () => searchResult([tweet("3", 5)])
    );

    const tweets = await fetchTimeline(config, accounts);

    assert.deepEqual(
      tweets.map((t) => t.id),
      ["1", "3"]
    );
  });
});
