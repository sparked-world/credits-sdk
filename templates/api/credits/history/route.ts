/**
 * GET /api/credits/history
 *
 * Returns transaction history for the authenticated user
 *
 * Query params:
 * - limit: number (default: 50, max: 100)
 * - startTime: timestamp (optional)
 * - endTime: timestamp (optional)
 */

import { auth } from '@clerk/nextjs/server';
import { type NextRequest, NextResponse } from 'next/server';
import { credits } from '@/lib/credits';

export async function GET(req: NextRequest) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const searchParams = req.nextUrl.searchParams;
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
  const startTime = searchParams.get('startTime')
    ? parseInt(searchParams.get('startTime')!, 10)
    : undefined;
  const endTime = searchParams.get('endTime')
    ? parseInt(searchParams.get('endTime')!, 10)
    : undefined;

  try {
    const transactions = await credits.getTransactions(userId, {
      limit,
      startTime,
      endTime,
    });

    return NextResponse.json({
      transactions,
      count: transactions.length,
      userId,
    });
  } catch (error) {
    console.error('Failed to get transaction history:', error);
    return NextResponse.json({ error: 'Failed to retrieve transaction history' }, { status: 500 });
  }
}
