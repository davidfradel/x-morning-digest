# X Morning Digest

A daily email digest of your X (Twitter) timeline — viral tweets, threads, and an AI-powered summary delivered to your inbox every morning.

## Features

- **Viral tweet detection** — scores tweets by engagement (likes, retweets, quotes) and surfaces the top performers
- **Thread detection** — identifies multi-tweet threads by conversation and author
- **AI summary** — Claude generates a structured analysis with trends, weak signals, and key takeaways
- **Beautiful HTML emails** — responsive cards with dark mode support
- **Multi-language** — digest and AI analysis in English, French, or Spanish
- **Scheduled or on-demand** — run via cron (daily) or `--now` for immediate execution
- **Followings cache** — caches your followings list (24h TTL) to reduce API calls

## How it works

```
1. Fetch followings    → Get accounts you follow on X (cached 24h)
2. Fetch tweets        → Search recent tweets from those accounts
3. Build digest        → Score tweets, detect virals & threads
4. AI summary          → Claude analyzes the digest content
5. Send email          → HTML email delivered via Resend
```

## Quick Start

### Prerequisites

- Node.js 18+
- API keys:
  - [twitterapi.io](https://twitterapi.io) — Twitter data
  - [Anthropic](https://console.anthropic.com) — Claude AI
  - [Resend](https://resend.com) — Email delivery

### Installation

```bash
git clone https://github.com/your-username/x-digest.git
cd x-digest
npm install
cp .env.example .env
```

Edit `.env` with your API keys and preferences.

### Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `TWITTER_API_KEY` | Yes | — | twitterapi.io API key |
| `TWITTER_USERNAME` | Yes | — | Your X handle (without @) |
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key |
| `RESEND_API_KEY` | Yes | — | Resend API key |
| `EMAIL_FROM` | Yes | — | Sender email address |
| `EMAIL_TO` | Yes | — | Recipient email address |
| `DIGEST_HOUR` | No | `7` | Hour (0-23) to send the daily digest |
| `LOOKBACK_HOURS` | No | `24` | How far back to fetch tweets (hours) |
| `VIRAL_THRESHOLD` | No | `100` | Minimum engagement score for viral tweets |
| `TOP_N_VIRAL` | No | `10` | Max number of viral tweets in digest |
| `TOP_N_THREADS` | No | `5` | Max number of threads in digest |
| `DIGEST_LANG` | No | `en` | Language: `en`, `fr`, or `es` |
| `FOLLOWINGS_CACHE_TTL` | No | `24` | Followings cache lifetime (hours) |

### Run

```bash
# One-time run
npm run now

# Scheduled (cron)
npm start
```

## Project Structure

```
src/
├── index.ts          # Entry point, cron scheduler, pipeline orchestration
├── config.ts         # Environment variable loading and validation
├── twitter.ts        # Twitter API client (followings, search, caching)
├── digest.ts         # Scoring, viral detection, thread detection
├── summarize.ts      # Claude AI summary generation
├── email.ts          # HTML email building and sending via Resend
├── translations.ts   # i18n strings (en, fr, es)
└── types.ts          # TypeScript interfaces
```

## Cost Estimate

Costs per run depend on your follow count and tweet volume. Typical example with ~60 accounts:

| Service | Estimate |
|---|---|
| twitterapi.io (profiles) | ~$0.01 |
| twitterapi.io (tweets) | ~$0.05–0.07 |
| Anthropic (Claude) | ~$0.01–0.02 |
| Resend (email) | Free tier |
| **Total per run** | **~$0.05–0.10** |

## Tech Stack

- **TypeScript** — type-safe codebase
- **Claude API** (Anthropic) — AI-powered analysis
- **twitterapi.io** — Twitter data access
- **Resend** — transactional email delivery
- **node-cron** — scheduling
- **marked** — Markdown to HTML conversion

## License

MIT
