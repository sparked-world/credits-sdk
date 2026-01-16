/**
 * POST /api/generate
 *
 * Canvas generation endpoint with fixed credit deduction
 * canvas.sparked.world - 50 credits (simple) or 75 credits (complex)
 */

import { auth } from '@clerk/nextjs/server';
import { FIXED_PRICING, InsufficientCreditsError } from '@sparked/credits-sdk';
import { type NextRequest, NextResponse } from 'next/server';
import { credits } from '@/lib/credits';

type Complexity = 'simple' | 'complex';

export async function POST(req: NextRequest) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { prompt, complexity = 'simple' } = body as {
      prompt: string;
      complexity?: Complexity;
    };

    // Determine cost based on complexity
    const cost =
      complexity === 'complex'
        ? FIXED_PRICING.canvas_generation_complex // 75 credits
        : FIXED_PRICING.canvas_generation_simple; // 50 credits

    // Deduct credits BEFORE generation
    const result = await credits.deduct(userId, cost, 'canvas_generation', {
      app: 'canvas.sparked.world',
      complexity,
      prompt_length: prompt?.length || 0,
    });

    // TODO: Replace with your actual canvas generation logic
    const canvas = await generateCanvas(prompt, complexity);

    return NextResponse.json({
      canvas,
      credits_remaining: result.balance,
      credits_used: cost,
      complexity,
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

    console.error('Canvas generation error:', error);
    return NextResponse.json({ error: 'Failed to generate canvas' }, { status: 500 });
  }
}

/**
 * Placeholder for actual canvas generation
 * TODO: Replace with your implementation
 */
async function generateCanvas(prompt: string, complexity: Complexity) {
  // Example: Call to DALL-E, Stable Diffusion, etc.
  return {
    id: `canvas_${Date.now()}`,
    url: 'https://example.com/canvas.png',
    prompt,
    complexity,
  };
}
