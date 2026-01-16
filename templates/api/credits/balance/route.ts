/**
 * GET /api/credits/balance
 *
 * Returns the current credit balance for the authenticated user
 */

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { credits } from '@/lib/credits';

export async function GET() {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const balance = await credits.getBalance(userId);

    return NextResponse.json({
      balance,
      userId,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Failed to get balance:', error);
    return NextResponse.json({ error: 'Failed to retrieve balance' }, { status: 500 });
  }
}
