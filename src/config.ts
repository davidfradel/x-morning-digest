import dotenv from "dotenv";
import type { LangCode } from "./translations.js";

dotenv.config();

export interface Config {
  twitterApiKey: string;
  twitterUsername: string;
  anthropicApiKey: string;
  resendApiKey: string;
  emailFrom: string;
  emailTo: string;
  digestHour: number;
  lookbackHours: number;
  viralThreshold: number;
  topNViral: number;
  topNThreads: number;
  lang: LangCode;
  followingsCacheTTL: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optionalEnvInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got: "${value}"`);
  }
  return parsed;
}

function optionalEnvString<T extends string>(name: string, fallback: T, allowed: T[]): T {
  const value = process.env[name];
  if (!value) return fallback;
  if (!allowed.includes(value as T)) {
    throw new Error(`Environment variable ${name} must be one of [${allowed.join(", ")}], got: "${value}"`);
  }
  return value as T;
}

export function loadConfig(): Config {
  return {
    twitterApiKey: requireEnv("TWITTER_API_KEY"),
    twitterUsername: requireEnv("TWITTER_USERNAME").replace(/^@/, ""),
    anthropicApiKey: requireEnv("ANTHROPIC_API_KEY"),
    resendApiKey: requireEnv("RESEND_API_KEY"),
    emailFrom: requireEnv("EMAIL_FROM"),
    emailTo: requireEnv("EMAIL_TO"),
    digestHour: optionalEnvInt("DIGEST_HOUR", 7),
    lookbackHours: optionalEnvInt("LOOKBACK_HOURS", 24),
    viralThreshold: optionalEnvInt("VIRAL_THRESHOLD", 100),
    topNViral: optionalEnvInt("TOP_N_VIRAL", 10),
    topNThreads: optionalEnvInt("TOP_N_THREADS", 5),
    lang: optionalEnvString("DIGEST_LANG", "en", ["en", "fr", "es"]),
    followingsCacheTTL: optionalEnvInt("FOLLOWINGS_CACHE_TTL", 24),
  };
}
