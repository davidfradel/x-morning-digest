import { Resend } from "resend";
import { marked } from "marked";
import type { Config } from "./config.js";
import type { DigestData, Thread, Tweet } from "./types.js";
import { getTranslations, type Translations } from "./translations.js";

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [email] ${msg}`);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

const DARK_MODE_STYLES = `
<style>
@media (prefers-color-scheme: dark) {
  .body { background: #15202b !important; }
  .section-light { background: #192734 !important; }
  .section-bg { background: #15202b !important; }
  .card { background: #192734 !important; border-color: #38444d !important; }
  .text-primary { color: #e7e9ea !important; }
  .text-secondary { color: #8899a6 !important; }
}
</style>`;

function buildTweetCard(tweet: Tweet, t: Translations): string {
  return `
    <div class="card" style="border:1px solid #e1e8ed;border-radius:12px;padding:16px;margin-bottom:12px;background:#fff;">
      <div style="display:flex;align-items:center;margin-bottom:8px;">
        <img src="${escapeHtml(tweet.authorAvatar)}" alt="" width="40" height="40" style="border-radius:50%;margin-right:10px;" />
        <div>
          <strong class="text-primary" style="color:#0f1419;">${escapeHtml(tweet.authorName)}</strong>
          <div class="text-secondary" style="color:#536471;font-size:13px;">@${escapeHtml(tweet.authorUsername)}</div>
        </div>
      </div>
      <p class="text-primary" style="color:#0f1419;font-size:15px;line-height:1.5;margin:0 0 12px 0;white-space:pre-wrap;">${escapeHtml(tweet.text)}</p>
      <div class="text-secondary" style="display:flex;gap:16px;color:#536471;font-size:13px;">
        <span>\u2764\ufe0f ${formatNumber(tweet.stats.likes)}</span>
        <span>\ud83d\udd01 ${formatNumber(tweet.stats.retweets)}</span>
        <span>\ud83d\udcac ${formatNumber(tweet.stats.replies)}</span>
        <span>\ud83d\udc41\ufe0f ${formatNumber(tweet.stats.views)}</span>
      </div>
      <div style="margin-top:10px;">
        <a href="${escapeHtml(tweet.url)}" style="color:#1d9bf0;text-decoration:none;font-size:13px;">${t.viewOnX}</a>
      </div>
    </div>`;
}

function buildThreadCard(thread: Thread, t: Translations): string {
  const displayCount = Math.min(thread.tweets.length, 1);
  const firstTweet = thread.tweets[0];
  const moreCount = thread.totalTweets - displayCount;

  return `
    <div class="card" style="border:1px solid #e1e8ed;border-radius:12px;padding:16px;margin-bottom:12px;background:#fff;border-left:4px solid #1d9bf0;">
      <div style="display:flex;align-items:center;margin-bottom:8px;">
        <img src="${escapeHtml(thread.authorAvatar)}" alt="" width="40" height="40" style="border-radius:50%;margin-right:10px;" />
        <div>
          <strong class="text-primary" style="color:#0f1419;">${escapeHtml(thread.authorName)}</strong>
          <span class="text-secondary" style="color:#536471;font-size:13px;margin-left:4px;">@${escapeHtml(thread.authorUsername)}</span>
          <div style="color:#1d9bf0;font-size:13px;">\ud83e\uddf5 ${t.threadLabel} \u00b7 ${thread.totalTweets} tweets</div>
        </div>
      </div>
      <p class="text-primary" style="color:#0f1419;font-size:15px;line-height:1.5;margin:0 0 12px 0;white-space:pre-wrap;">${escapeHtml(firstTweet.text)}</p>
      ${moreCount > 0 ? `<div class="text-secondary" style="color:#536471;font-size:13px;margin-bottom:8px;">${t.moreInThread(moreCount)}</div>` : ""}
      <a href="${escapeHtml(thread.url)}" style="color:#1d9bf0;text-decoration:none;font-size:13px;">${t.readFullThread}</a>
    </div>`;
}

function splitSummary(summary: string): { trends: string; weakSignals: string } {
  const sections = summary.split(/(?=^## )/m);
  let trends = "";
  let weakSignals = "";

  for (const section of sections) {
    const lower = section.toLowerCase();
    if (lower.includes("tendances") || lower.includes("trends") || lower.includes("tendencias")) {
      // Remove the ## heading line — we render our own heading in the template
      trends = section.replace(/^## .+\n?/, "").trim();
    } else if (lower.includes("signaux") || lower.includes("signals") || lower.includes("señales") || lower.includes("se\u00f1ales")) {
      weakSignals = section.replace(/^## .+\n?/, "").trim();
    }
  }

  return { trends, weakSignals };
}

export async function buildEmailHtml(
  digest: DigestData,
  summary: string,
  config: Config
): Promise<string> {
  const t = getTranslations(config.lang);
  const { trends, weakSignals } = splitSummary(summary);
  const trendsHtml = await marked(trends);
  const weakSignalsHtml = await marked(weakSignals);
  const dateFormatted = new Date(digest.date).toLocaleDateString(t.dateLocale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const viralCards = digest.virals.map((tw) => buildTweetCard(tw, t)).join("");
  const threadCards = digest.threads.map((th) => buildThreadCard(th, t)).join("");

  return `<!DOCTYPE html>
<html lang="${config.lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  <title>X Digest - ${escapeHtml(digest.date)}</title>
</head>
<body class="body" style="margin:0;padding:0;background:#f5f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  ${DARK_MODE_STYLES}
  <div style="max-width:600px;margin:0 auto;padding:20px;">

    <!-- Header -->
    <div style="background:#15202b;color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
      <h1 style="margin:0;font-size:24px;">\u2615 ${escapeHtml(t.emailTitle)}</h1>
      <p style="margin:8px 0 0;color:#8899a6;font-size:14px;">${escapeHtml(dateFormatted)}</p>
    </div>

    ${trends ? `
    <!-- Trends -->
    <div class="section-light" style="background:#fff;padding:24px;border-bottom:1px solid #e1e8ed;">
      <h2 class="text-primary" style="margin:0 0 16px;color:#0f1419;font-size:18px;">\ud83d\udd25 ${t.trendsHeading}</h2>
      <div class="text-primary" style="color:#0f1419;font-size:15px;line-height:1.6;">
        ${trendsHtml}
      </div>
    </div>
    ` : ""}

    ${digest.virals.length > 0 ? `
    <!-- Viral tweets -->
    <div class="section-bg" style="background:#f5f8fa;padding:24px;">
      <h2 class="text-primary" style="margin:0 0 16px;color:#0f1419;font-size:18px;">\ud83d\udd25 ${t.viralTweetsHeading} (${digest.virals.length})</h2>
      ${viralCards}
    </div>
    ` : ""}

    ${digest.threads.length > 0 ? `
    <!-- Threads -->
    <div class="section-bg" style="background:#f5f8fa;padding:24px;">
      <h2 class="text-primary" style="margin:0 0 16px;color:#0f1419;font-size:18px;">\ud83e\uddf5 ${t.threadsHeading} (${digest.threads.length})</h2>
      ${threadCards}
    </div>
    ` : ""}

    ${weakSignals ? `
    <!-- Weak Signals -->
    <div class="section-light" style="background:#fff;padding:24px;border-bottom:1px solid #e1e8ed;">
      <h2 class="text-primary" style="margin:0 0 16px;color:#0f1419;font-size:18px;">\ud83d\udce1 ${t.weakSignalsHeading}</h2>
      <div class="text-primary" style="color:#0f1419;font-size:15px;line-height:1.6;">
        ${weakSignalsHtml}
      </div>
    </div>
    ` : ""}

    <!-- Footer -->
    <div style="background:#15202b;color:#8899a6;padding:20px;border-radius:0 0 12px 12px;text-align:center;font-size:13px;">
      <p style="margin:0;">
        ${digest.totalTweetsFetched} ${t.tweetsAnalyzed} \u00b7 ${digest.accountsChecked} ${t.accountsFollowed}
      </p>
      <p style="margin:8px 0 0;">
        ${t.generatedBy}
      </p>
    </div>

  </div>
</body>
</html>`;
}

export async function sendDigestEmail(
  digest: DigestData,
  summary: string,
  config: Config
): Promise<void> {
  const t = getTranslations(config.lang);
  const html = await buildEmailHtml(digest, summary, config);
  const resend = new Resend(config.resendApiKey);

  log(`Sending digest email to ${config.emailTo}...`);

  const { error } = await resend.emails.send({
    from: config.emailFrom,
    to: config.emailTo,
    subject: `\u2615 X Digest \u2014 ${digest.date}`,
    html,
  });

  if (error) {
    throw new Error(`Resend error: ${JSON.stringify(error)}`);
  }

  log("Digest email sent successfully");
}

export async function sendAlertEmail(
  error: Error,
  config: Config
): Promise<void> {
  const t = getTranslations(config.lang);
  const resend = new Resend(config.resendApiKey);

  log(`Sending alert email to ${config.emailTo}...`);

  const html = `<!DOCTYPE html>
<html lang="${config.lang}">
<head>
  <meta charset="utf-8" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
</head>
<body class="body" style="margin:0;padding:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f8fa;">
  ${DARK_MODE_STYLES}
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;" class="section-light">
    <div style="background:#e74c3c;color:#fff;padding:20px;text-align:center;">
      <h1 style="margin:0;font-size:20px;">\u26a0\ufe0f ${t.errorTitle}</h1>
    </div>
    <div style="padding:24px;">
      <p class="text-primary" style="color:#0f1419;font-size:15px;">${t.errorEncountered}</p>
      <pre class="section-bg" style="background:#f5f8fa;padding:16px;border-radius:8px;overflow-x:auto;font-size:13px;color:#e74c3c;">${escapeHtml(error.message)}</pre>
      <p class="text-secondary" style="color:#536471;font-size:13px;">${t.stackTrace}</p>
      <pre class="section-bg text-secondary" style="background:#f5f8fa;padding:16px;border-radius:8px;overflow-x:auto;font-size:12px;color:#536471;">${escapeHtml(error.stack ?? "N/A")}</pre>
    </div>
  </div>
</body>
</html>`;

  const { error: sendError } = await resend.emails.send({
    from: config.emailFrom,
    to: config.emailTo,
    subject: `\u26a0\ufe0f ${t.errorSubjectPrefix} ${new Date().toISOString().split("T")[0]}`,
    html,
  });

  if (sendError) {
    console.error("Failed to send alert email:", sendError);
  } else {
    log("Alert email sent");
  }
}
