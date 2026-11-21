import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { Config } from "../src/config.js";
import type { TwitterApiSearchResponse, TwitterApiTweet, TwitterApiUserTweetsResponse } from "../src/types.js";
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

function timelineResult(tweets: TwitterApiTweet[]): Response {
  const body: TwitterApiUserTweetsResponse = {
    status: "success",
    code: 0,
    msg: "success",
    data: { pin_tweet: null, tweets },
    has_next_page: false,
    next_cursor: "",
  };
  return new Response(JSON.stringify(body), { status: 200 });
}

/** Twitter's createdAt format, e.g. "Sat Nov 21 11:08:48 +0000 2026". */
function twitterDate(date: Date): string {
  const [weekday, day, month, year, time] = date.toUTCString().replace(",", "").split(" ");
  return `${weekday} ${month} ${day} ${time} +0000 ${year}`;
}

function tweet(
  id: string,
  hoursAgo: number,
  { userName = "account0", isRetweet = false }: { userName?: string; isRetweet?: boolean } = {}
): TwitterApiTweet {
  return {
    id,
    text: `tweet ${id}`,
    createdAt: twitterDate(new Date(Date.now() - hoursAgo * 60 * 60 * 1000)),
    author: {
      id: "42",
      userName,
      name: `Name of ${userName}`,
      profilePicture: "https://pbs.twimg.com/profile_images/42/avatar.jpg",
      isVerified: false,
    },
    isRetweet,
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

/** Routes fetch calls to the search endpoint or to the per-account timeline endpoint, and counts them. */
function stubApi(handlers: { search: () => Response; timeline: (userName: string) => Response }) {
  const calls = { search: 0, timeline: 0 };
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname === "/twitter/tweet/advanced_search") {
      calls.search++;
      return handlers.search();
    }
    if (url.pathname === "/twitter/user/last_tweets") {
      calls.timeline++;
      return handlers.timeline(url.searchParams.get("userName") ?? "");
    }
    throw new Error(`unexpected request to ${url.pathname}`);
  });
  return calls;
}

/** One recent tweet per account, the way a healthy timeline endpoint answers. */
function recentTweetOf(userName: string): Response {
  return timelineResult([tweet(`${userName}-recent`, 2, { userName })]);
}

/** Runs code that sleeps between retries without waiting: mocked timers are advanced until it settles. */
async function withInstantBackoff<T>(run: () => Promise<T>): Promise<T> {
  mock.timers.enable({ apis: ["setTimeout"] });
  let settled = false;
  const result = run().finally(() => {
    settled = true;
  });
  result.catch(() => {});
  while (!settled) {
    mock.timers.tick(60_000);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return result;
}

beforeEach(() => {
  mock.method(console, "log", () => {});
});

afterEach(() => {
  mock.timers.reset();
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
  it("returns the tweets posted inside the lookback window, without using the per-account timelines", async () => {
    const pages = [
      () => searchResult([tweet("1", 2), tweet("2", 30)]),
      () => searchResult([tweet("3", 5)]),
    ];
    let page = 0;
    const calls = stubApi({ search: () => pages[page++](), timeline: recentTweetOf });

    const tweets = await fetchTimeline(config, accounts);

    assert.deepEqual(
      tweets.map((t) => t.id),
      ["1", "3"]
    );
    assert.equal(calls.timeline, 0);
  });

  it("returns no tweets, without failing, when the API only has tweets older than the lookback window", async () => {
    stubApi({ search: () => searchResult([tweet("1", 30)]), timeline: recentTweetOf });

    const tweets = await fetchTimeline(config, accounts);

    assert.deepEqual(tweets, []);
  });

  it("falls back to the per-account timelines when search keeps answering 503", async () => {
    stubApi({ search: unavailable, timeline: recentTweetOf });

    const tweets = await withInstantBackoff(() => fetchTimeline(config, accounts));

    assert.deepEqual(
      tweets.map((t) => t.id).sort(),
      accounts.map((a) => `${a}-recent`).sort()
    );
  });

  it("falls back to the per-account timelines when search answers 200 with no tweets", async () => {
    stubApi({ search: () => searchResult([]), timeline: recentTweetOf });

    const tweets = await fetchTimeline(config, accounts);

    assert.deepEqual(
      tweets.map((t) => t.id).sort(),
      accounts.map((a) => `${a}-recent`).sort()
    );
  });

  it("keeps only the account's own recent tweets from a timeline", async () => {
    stubApi({
      search: () => searchResult([]),
      timeline: (userName) =>
        timelineResult([
          tweet(`${userName}-recent`, 2, { userName }),
          tweet(`${userName}-retweet`, 3, { userName: "someone_else", isRetweet: true }),
          tweet(`${userName}-old`, 30, { userName }),
        ]),
    });

    const tweets = await fetchTimeline(config, ["account0"]);

    assert.deepEqual(
      tweets.map((t) => t.id),
      ["account0-recent"]
    );
  });

  it("still returns the other accounts' tweets when one account's timeline keeps failing", async () => {
    stubApi({
      search: () => searchResult([]),
      timeline: (userName) => (userName === "account3" ? unavailable() : recentTweetOf(userName)),
    });

    const tweets = await withInstantBackoff(() => fetchTimeline(config, accounts));

    assert.deepEqual(
      tweets.map((t) => t.id).sort(),
      accounts
        .filter((a) => a !== "account3")
        .map((a) => `${a}-recent`)
        .sort()
    );
  });

  it("fails instead of reporting a quiet day when neither search nor the timelines return anything", async () => {
    stubApi({ search: () => searchResult([]), timeline: () => timelineResult([]) });

    await assert.rejects(fetchTimeline(config, accounts), /30 accounts/);
  });

  it("fails naming both endpoints, without trying every account, when the timelines are down too", async () => {
    const attempted = new Set<string>();
    stubApi({
      search: unavailable,
      timeline: (userName) => {
        attempted.add(userName);
        return unavailable();
      },
    });

    await assert.rejects(
      withInstantBackoff(() => fetchTimeline(config, accounts)),
      (err: Error) => {
        assert.match(err.message, /advanced_search/);
        assert.match(err.message, /last_tweets/);
        return true;
      }
    );
    assert.ok(attempted.size < accounts.length, `tried ${attempted.size} of ${accounts.length} accounts`);
  });
});
