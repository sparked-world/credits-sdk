/**
 * POST /api/video/generate
 *
 * Video generation endpoint with metered credit deduction
 * studio.sparked.world - 10 credits per second of video
 */

import { auth } from '@clerk/nextjs/server';
import { InsufficientCreditsError, PricingEngine } from '@sparked/credits-sdk';
import { type NextRequest, NextResponse } from 'next/server';
import { credits } from '@/lib/credits';

const pricing = new PricingEngine();

export async function POST(req: NextRequest) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      prompt,
      duration,
      resolution = '1080p',
    } = body as {
      prompt: string;
      duration: number;
      resolution?: string;
    };

    // Validate duration
    if (!duration || duration <= 0 || duration > 300) {
      return NextResponse.json(
        { error: 'Invalid duration (must be 1-300 seconds)' },
        { status: 400 }
      );
    }

    // Calculate cost based on video duration
    const cost = pricing.calculateCost('video_generation', duration);

    // Pre-check balance before expensive operation
    const balance = await credits.getBalance(userId);
    if (balance < cost) {
      return NextResponse.json(
        {
          error: 'Insufficient credits',
          estimated_cost: cost,
          available: balance,
          duration,
          credits_per_second: 10,
        },
        { status: 402 }
      );
    }

    // Deduct credits BEFORE generation
    const result = await credits.deduct(userId, cost, 'video_generation', {
      app: 'studio.sparked.world',
      duration,
      resolution,
      credits_per_second: 10,
      prompt_length: prompt?.length || 0,
    });

    // TODO: Replace with your actual video generation logic
    const video = await generateVideo(prompt, duration, resolution);

    return NextResponse.json({
      video,
      credits_remaining: result.balance,
      credits_used: cost,
      duration,
      credits_per_second: 10,
    });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return NextResponse.json(
        {
          error: 'Insufficient credits',
          required: error.required,
          available: error.available,
        },
        { status: 402 }
      );
    }

    console.error('Video generation error:', error);
    return NextResponse.json({ error: 'Failed to generate video' }, { status: 500 });
  }
}

/**
 * Placeholder for actual video generation
 * TODO: Replace with your implementation
 */
async function generateVideo(prompt: string, duration: number, resolution: string) {
  // Example: Call to Runway, Stability AI, etc.
  return {
    id: `video_${Date.now()}`,
    url: 'https://example.com/video.mp4',
    prompt,
    duration,
    resolution,
  };
}
