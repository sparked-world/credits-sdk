/**
 * Balance Reconciliation Script
 *
 * Verifies and fixes credit balances across all users by comparing
 * cached balances with transaction logs.
 *
 * Usage:
 *   pnpm tsx scripts/reconcile-balances.ts
 *
 * Schedule with system cron (every 6 hours):
 *   0 STAR/6 STAR STAR STAR cd /path/to/app && pnpm tsx scripts/reconcile-balances.ts
 *   (Replace STAR with asterisk)
 *
 * Or use Vercel Cron (see vercel.json example)
 */

import { CreditsSDK } from '@sparked/credits-sdk';

// Initialize SDK
const credits = new CreditsSDK({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
});

interface ReconciliationStats {
  total: number;
  verified: number;
  fixed: number;
  errors: number;
  inconsistencies: Array<{
    userId: string;
    cached: number;
    calculated: number;
    difference: number;
  }>;
}

/**
 * Get all user IDs from your user database
 * TODO: Replace with your implementation
 */
async function getAllUserIds(): Promise<string[]> {
  // Option 1: From Clerk
  // const { clerkClient } = await import('@clerk/nextjs/server');
  // const users = await clerkClient.users.getUserList({ limit: 500 });
  // return users.map(u => u.id);

  // Option 2: From your database
  // const users = await db.user.findMany({ select: { id: true } });
  // return users.map(u => u.id);

  // Option 3: Scan Redis keys (not recommended for large datasets)
  // This is a placeholder - you should use one of the above methods
  console.warn('getAllUserIds not implemented - using empty array');
  return [];
}

/**
 * Reconcile balances for all users
 */
async function reconcileAll(): Promise<ReconciliationStats> {
  console.log('🔄 Starting balance reconciliation...\n');

  const stats: ReconciliationStats = {
    total: 0,
    verified: 0,
    fixed: 0,
    errors: 0,
    inconsistencies: [],
  };

  const userIds = await getAllUserIds();
  stats.total = userIds.length;

  console.log(`Found ${userIds.length} users to reconcile\n`);

  for (const userId of userIds) {
    try {
      const verification = await credits.verifyBalance(userId);

      if (!verification.valid) {
        console.log(`⚠️  Inconsistency detected for user ${userId}:`);
        console.log(
          `   Cached: ${verification.cached}, Calculated: ${verification.calculated}, Diff: ${verification.difference}`
        );

        stats.inconsistencies.push({
          userId,
          cached: verification.cached,
          calculated: verification.calculated,
          difference: verification.difference,
        });

        // Fix the balance
        const correctedBalance = await credits.rebuildBalance(userId);
        console.log(`   ✓ Fixed balance to: ${correctedBalance}\n`);
        stats.fixed++;
      } else {
        stats.verified++;
      }
    } catch (error) {
      console.error(`✗ Error reconciling user ${userId}:`, error);
      stats.errors++;
    }
  }

  return stats;
}

/**
 * Print reconciliation summary
 */
function printSummary(stats: ReconciliationStats) {
  console.log(`\n${'='.repeat(50)}`);
  console.log('Reconciliation Summary');
  console.log('='.repeat(50));
  console.log(`Total users:          ${stats.total}`);
  console.log(`✓ Verified:           ${stats.verified}`);
  console.log(`✓ Fixed:              ${stats.fixed}`);
  console.log(`✗ Errors:             ${stats.errors}`);
  console.log('='.repeat(50));

  if (stats.inconsistencies.length > 0) {
    console.log('\nInconsistencies found:');
    stats.inconsistencies.forEach(({ userId, cached, calculated, difference }) => {
      console.log(`  ${userId}: ${cached} → ${calculated} (diff: ${difference})`);
    });
  }

  if (stats.fixed > 0) {
    console.log(`\n✓ Successfully fixed ${stats.fixed} balance(s)`);
  }

  if (stats.errors > 0) {
    console.log(`\n⚠️  ${stats.errors} error(s) occurred - check logs`);
  }

  console.log('\n✓ Reconciliation complete\n');
}

/**
 * Main execution
 */
async function main() {
  const startTime = Date.now();

  try {
    const stats = await reconcileAll();
    printSummary(stats);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Duration: ${duration}s`);

    // Exit with error code if there were unfixed issues
    if (stats.errors > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Fatal error during reconciliation:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { reconcileAll, type ReconciliationStats };
