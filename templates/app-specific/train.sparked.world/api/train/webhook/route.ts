/**
 * POST /api/train/webhook
 *
 * Training job completion webhook
 * Charges actual cost based on GPU hours used
 */

import { InsufficientCreditsError, PricingEngine } from '@sparked/credits-sdk';
import { type NextRequest, NextResponse } from 'next/server';
import { credits } from '@/lib/credits';

const pricing = new PricingEngine();

export async function POST(req: NextRequest) {
  // TODO: Verify webhook signature if using external service

  try {
    const body = await req.json();
    const { jobId, status, userId, metrics } = body as {
      jobId: string;
      status: 'completed' | 'failed';
      userId: string;
      metrics: {
        gpu_hours: number;
        estimated_hours: number;
      };
    };

    if (status === 'completed') {
      // Calculate actual cost based on GPU hours used
      const actualCost = pricing.calculateCost('training_job', metrics.gpu_hours);

      try {
        // Deduct actual cost
        const result = await credits.deduct(userId, actualCost, 'training_completed', {
          app: 'train.sparked.world',
          job_id: jobId,
          gpu_hours: metrics.gpu_hours,
          estimated_hours: metrics.estimated_hours,
          credits_per_gpu_hour: 1000,
        });

        console.log(`✓ Training job ${jobId} completed`);
        console.log(`  User: ${userId}`);
        console.log(`  GPU hours: ${metrics.gpu_hours} (estimated: ${metrics.estimated_hours})`);
        console.log(`  Cost: ${actualCost} credits`);
        console.log(`  Remaining: ${result.balance} credits`);

        // TODO: Update job status in database
        await updateJobStatus(jobId, 'completed', {
          credits_charged: actualCost,
          gpu_hours: metrics.gpu_hours,
        });

        return NextResponse.json({
          success: true,
          credits_charged: actualCost,
          new_balance: result.balance,
        });
      } catch (error) {
        if (error instanceof InsufficientCreditsError) {
          console.error(`✗ User ${userId} ran out of credits during training`);
          console.error(`  Required: ${error.required}, Available: ${error.available}`);

          // TODO: Handle gracefully - pause job, notify user, etc.
          await pauseTrainingJob(jobId);
          await notifyUser(userId, {
            type: 'training_paused',
            message: 'Training paused: insufficient credits',
            jobId,
            required: error.required,
            available: error.available,
          });

          return NextResponse.json(
            {
              error: 'Insufficient credits',
              paused: true,
              required: error.required,
              available: error.available,
            },
            { status: 402 }
          );
        }
        throw error;
      }
    } else if (status === 'failed') {
      console.log(`✗ Training job ${jobId} failed - no credits charged`);

      // TODO: Update job status in database
      await updateJobStatus(jobId, 'failed');

      return NextResponse.json({ success: true, charged: false });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Training webhook error:', error);
    return NextResponse.json({ error: 'Failed to process training webhook' }, { status: 500 });
  }
}

/**
 * Update job status in database
 * TODO: Replace with your implementation
 */
async function updateJobStatus(jobId: string, status: string, metadata?: Record<string, any>) {
  // Example: Update in database
  console.log(`Updating job ${jobId} to status ${status}`, metadata);
}

/**
 * Pause a training job
 * TODO: Replace with your implementation
 */
async function pauseTrainingJob(jobId: string) {
  // Example: Send pause signal to training cluster
  console.log(`Pausing training job ${jobId}`);
}

/**
 * Notify user about job status
 * TODO: Replace with your implementation
 */
async function notifyUser(
  userId: string,
  notification: {
    type: string;
    message: string;
    jobId: string;
    required?: number;
    available?: number;
  }
) {
  // Example: Send email, push notification, etc.
  console.log(`Notifying user ${userId}:`, notification);
}
