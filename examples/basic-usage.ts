/**
 * Basic usage examples for @sparked/credits-sdk
 */

import {
  CreditsSDK,
  FIXED_PRICING,
  InsufficientCreditsError,
  PricingEngine,
} from '@sparked/credits-sdk';

// Initialize the SDK
const credits = new CreditsSDK({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
  options: {
    defaultCredits: 100,
  },
});

// Initialize the pricing engine for metered operations
const pricing = new PricingEngine();

// Example 1: Initialize a new user
async function initializeNewUser(userId: string) {
  const result = await credits.initializeUser(userId, 100);
  console.log(`User ${userId} initialized with ${result.balance} credits`);
}

// Example 2: Fixed cost deduction (chat message)
async function deductChatMessage(userId: string) {
  try {
    const result = await credits.deduct(
      userId,
      FIXED_PRICING.chat_message, // 10 credits
      'chat_message',
      {
        app: 'app.sparked.world',
        model: 'claude-sonnet-4',
      }
    );

    console.log(`Chat message processed. Remaining credits: ${result.balance}`);
    return result;
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      console.error(`Insufficient credits: need ${error.required}, have ${error.available}`);
      throw error;
    }
    throw error;
  }
}

// Example 3: Fixed cost deduction (canvas generation)
async function deductCanvasGeneration(userId: string, complexity: 'simple' | 'complex') {
  const cost =
    complexity === 'complex'
      ? FIXED_PRICING.canvas_generation_complex // 75 credits
      : FIXED_PRICING.canvas_generation_simple; // 50 credits

  const result = await credits.deduct(userId, cost, 'canvas_generation', {
    app: 'canvas.sparked.world',
    complexity,
  });

  console.log(`Canvas generated. Remaining credits: ${result.balance}`);
  return result;
}

// Example 4: Metered cost deduction (video generation)
async function deductVideoGeneration(userId: string, durationSeconds: number) {
  // Calculate cost based on duration
  const cost = pricing.calculateCost('video_generation', durationSeconds);

  // Pre-check balance
  const balance = await credits.getBalance(userId);
  if (balance < cost) {
    throw new InsufficientCreditsError(cost, balance);
  }

  const result = await credits.deduct(userId, cost, 'video_generation', {
    app: 'studio.sparked.world',
    duration: durationSeconds,
    credits_per_second: 10,
  });

  console.log(`Video generated (${durationSeconds}s). Cost: ${cost} credits`);
  return result;
}

// Example 5: Metered cost deduction (training job)
async function _deductTrainingJob(userId: string, gpuHours: number) {
  const cost = pricing.calculateCost('training_job', gpuHours);

  const result = await credits.deduct(userId, cost, 'training_completed', {
    app: 'train.sparked.world',
    gpu_hours: gpuHours,
  });

  console.log(`Training completed (${gpuHours}h). Cost: ${cost} credits`);
  return result;
}

// Example 6: Add credits (purchase)
async function addCredits(userId: string, amount: number, paymentId: string) {
  const result = await credits.add(userId, amount, 'purchase', {
    payment_id: paymentId,
    amount_usd: amount / 10, // Example: 10 credits = $1
  });

  console.log(`Credits purchased. New balance: ${result.balance}`);
  return result;
}

// Example 7: Get balance
async function checkBalance(userId: string) {
  const balance = await credits.getBalance(userId);
  console.log(`User ${userId} has ${balance} credits`);
  return balance;
}

// Example 8: Get transaction history
async function getTransactionHistory(userId: string) {
  const transactions = await credits.getTransactions(userId, {
    limit: 10,
  });

  console.log(`Found ${transactions.length} transactions:`);
  transactions.forEach((tx) => {
    console.log(`- ${tx.action}: ${tx.amount} credits at ${new Date(tx.timestamp)}`);
  });

  return transactions;
}

// Example 9: Verify and reconcile balance
async function verifyAndReconcileBalance(userId: string) {
  const verification = await credits.verifyBalance(userId);

  if (!verification.valid) {
    console.log(
      `Balance mismatch detected! Cached: ${verification.cached}, Calculated: ${verification.calculated}`
    );

    // Fix the inconsistency
    const correctedBalance = await credits.rebuildBalance(userId);
    console.log(`Balance corrected to: ${correctedBalance}`);
    return correctedBalance;
  } else {
    console.log(`Balance verified: ${verification.cached} credits`);
    return verification.cached;
  }
}

// Example 10: Complete workflow
async function completeWorkflow() {
  const userId = 'user_123';

  // 1. Initialize user
  await initializeNewUser(userId);

  // 2. Process some operations
  await deductChatMessage(userId);
  await deductCanvasGeneration(userId, 'simple');

  // 3. Check balance
  const balance = await checkBalance(userId);

  // 4. Add more credits if needed
  if (balance < 50) {
    await addCredits(userId, 100, 'pay_123');
  }

  // 5. Process metered operation
  await deductVideoGeneration(userId, 30); // 30 second video

  // 6. View transaction history
  await getTransactionHistory(userId);

  // 7. Verify balance integrity
  await verifyAndReconcileBalance(userId);
}

// Run the workflow
completeWorkflow().catch(console.error);
