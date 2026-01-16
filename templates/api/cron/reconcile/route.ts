/**
 * GET /api/cron/reconcile
 *
 * Vercel Cron endpoint for scheduled balance reconciliation
 *
 * Setup in vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/reconcile",
 *     "schedule": "0 *\/6 * * *"
 *   }]
 * }
 *
 * Required environment variable:
 * - CRON_SECRET (generate with: openssl rand -base64 32)
 */

import { CreditsSDK } from '@sparked/credits-sdk';
import { type NextRequest, NextResponse } from 'next/server';

const credits = new CreditsSDK({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
});

export async function GET(request: NextRequest) {
  // Verify cron secret to prevent unauthorized access
  const authHeader = request.headers.get('authorization');
  const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;

  if (authHeader !== expectedAuth) {
    console.error('Unauthorized cron request');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();
  console.log('🔄 Starting scheduled balance reconciliation...');

  let verified = 0;
  let fixed = 0;
  let errors = 0;

  try {
    // Get all user IDs
    const userIds = await getAllUserIds();
    console.log(`Found ${userIds.length} users to reconcile`);

    // Reconcile each user
    for (const userId of userIds) {
      try {
        const verification = await credits.verifyBalance(userId);

        if (!verification.valid) {
          console.log(`Fixing ${userId}: ${verification.cached} → ${verification.calculated}`);
          await credits.rebuildBalance(userId);
          fixed++;
        } else {
          verified++;
        }
      } catch (error) {
        console.error(`Error reconciling ${userId}:`, error);
        errors++;
      }
    }

    const duration = Date.now() - startTime;
    const summary = {
      success: true,
      total: userIds.length,
      verified,
      fixed,
      errors,
      duration_ms: duration,
    };

    console.log('✓ Reconciliation complete:', summary);

    return NextResponse.json(summary);
  } catch (error) {
    console.error('Reconciliation failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Reconciliation failed',
        verified,
        fixed,
        errors,
      },
      { status: 500 }
    );
  }
}

/**
 * Get all user IDs
 * TODO: Replace with your implementation
 */
async function getAllUserIds(): Promise<string[]> {
  // Example implementations:

  // Option 1: From Clerk
  // const { clerkClient } = await import('@clerk/nextjs/server');
  // const users = await clerkClient.users.getUserList({ limit: 500 });
  // return users.map(u => u.id);

  // Option 2: From database
  // const users = await db.user.findMany({ select: { id: true } });
  // return users.map(u => u.id);

  console.warn('getAllUserIds not implemented - returning empty array');
  return [];
}
