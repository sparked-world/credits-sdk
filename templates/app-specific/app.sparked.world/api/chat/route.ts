/**
 * POST /api/chat
 *
 * Chat endpoint with fixed credit deduction
 * app.sparked.world - 10 credits per message
 */

import { auth } from '@clerk/nextjs/server';
import { FIXED_PRICING, InsufficientCreditsError } from '@sparked/credits-sdk';
import { type NextRequest, NextResponse } from 'next/server';
import { credits } from '@/lib/credits';

export async function POST(req: NextRequest) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { message, model = 'claude-sonnet-4' } = body;

    // Deduct credits BEFORE processing (fail fast)
    const result = await credits.deduct(
      userId,
      FIXED_PRICING.chat_message, // 10 credits
      'chat_message',
      {
        app: 'app.sparked.world',
        model,
        message_length: message?.length || 0,
      }
    );

    // TODO: Replace with your actual chat processing logic
    const response = await processChatMessage(message, model);

    return NextResponse.json({
      response,
      credits_remaining: result.balance,
      credits_used: FIXED_PRICING.chat_message,
    });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return NextResponse.json(
        {
          error: 'Insufficient credits',
          required: error.required,
          available: error.available,
          message: 'Please add more credits to continue',
        },
        { status: 402 }
      );
    }

    console.error('Chat processing error:', error);
    return NextResponse.json({ error: 'Failed to process chat message' }, { status: 500 });
  }
}

/**
 * Placeholder for actual chat processing
 * TODO: Replace with your implementation
 */
async function processChatMessage(message: string, model: string) {
  // Example: Call to Anthropic API, OpenAI, etc.
  return {
    content: `Echo: ${message}`,
    model,
  };
}
