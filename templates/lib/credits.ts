/**
 * Credits SDK client initialization
 *
 * Copy this file to your Next.js app: lib/credits.ts
 *
 * Environment variables required:
 * - UPSTASH_REDIS_URL
 * - UPSTASH_REDIS_TOKEN
 */

import { CreditsSDK } from '@sparked/credits-sdk';

if (!process.env.UPSTASH_REDIS_URL || !process.env.UPSTASH_REDIS_TOKEN) {
  throw new Error(
    'Missing required environment variables: UPSTASH_REDIS_URL and UPSTASH_REDIS_TOKEN'
  );
}

export const credits = new CreditsSDK({
  url: process.env.UPSTASH_REDIS_URL,
  token: process.env.UPSTASH_REDIS_TOKEN,
  options: {
    defaultCredits: 100, // Free tier credits for new users
  },
});
