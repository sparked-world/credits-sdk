/**
 * POST /api/admin/credits/grant
 *
 * Admin endpoint to grant credits to users
 *
 * Request body:
 * {
 *   "targetUserId": "user_123",
 *   "amount": 1000,
 *   "reason": "Promotional credit"
 * }
 *
 * Note: Update the checkIsAdmin function with your admin logic
 */

import { auth } from '@clerk/nextjs/server';
import { type NextRequest, NextResponse } from 'next/server';
import { credits } from '@/lib/credits';

/**
 * Check if a user is an admin
 * TODO: Implement your admin check logic
 */
async function checkIsAdmin(_userId: string): Promise<boolean> {
  // Example implementations:

  // Option 1: Check Clerk metadata
  // const { clerkClient } = await import('@clerk/nextjs/server');
  // const user = await clerkClient.users.getUser(userId);
  // return user.publicMetadata.role === 'admin';

  // Option 2: Check hardcoded admin list
  // const adminIds = process.env.ADMIN_USER_IDS?.split(',') || [];
  // return adminIds.includes(userId);

  // Option 3: Check database
  // const user = await db.user.findUnique({ where: { id: userId } });
  // return user?.role === 'admin';

  // For now, return false (no admins)
  console.warn('Admin check not implemented - denying access');
  return false;
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check if user is admin
  const isAdmin = await checkIsAdmin(userId);
  if (!isAdmin) {
    return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { targetUserId, amount, reason } = body;

    // Validate input
    if (!targetUserId || typeof targetUserId !== 'string') {
      return NextResponse.json({ error: 'Invalid targetUserId' }, { status: 400 });
    }

    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json(
        { error: 'Invalid amount (must be positive number)' },
        { status: 400 }
      );
    }

    if (!reason || typeof reason !== 'string') {
      return NextResponse.json({ error: 'Reason is required' }, { status: 400 });
    }

    // Grant credits
    const result = await credits.add(targetUserId, amount, 'admin_grant', {
      granted_by: userId,
      admin_action: true,
      reason,
    });

    console.log(`✓ Admin ${userId} granted ${amount} credits to ${targetUserId}`);
    console.log(`  Reason: ${reason}`);
    console.log(`  New balance: ${result.balance}`);

    return NextResponse.json({
      success: true,
      txId: result.txId,
      newBalance: result.balance,
      amount,
      targetUserId,
    });
  } catch (error) {
    console.error('Failed to grant credits:', error);
    return NextResponse.json({ error: 'Failed to grant credits' }, { status: 500 });
  }
}
