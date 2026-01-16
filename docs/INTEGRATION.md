# Integration Guide

This guide walks you through integrating `@sparked/credits-sdk` into your Next.js applications.

## Table of Contents

1. [Setup](#setup)
2. [App Integration](#app-integration)
3. [Clerk Webhook Setup](#clerk-webhook-setup)
4. [API Route Examples](#api-route-examples)
5. [UI Components](#ui-components)
6. [Monitoring & Reconciliation](#monitoring--reconciliation)

---

## Setup

### 1. Install the Package

In each of your Next.js apps:

```bash
npm install @sparked/credits-sdk
```

### 2. Set Environment Variables

Add to `.env.local` in each app:

```bash
UPSTASH_REDIS_URL=https://your-redis.upstash.io
UPSTASH_REDIS_TOKEN=your_token_here
CLERK_WEBHOOK_SECRET=whsec_xxxxx
```

### 3. Create Credits Client

Create `lib/credits.ts` in each app:

```typescript
import { CreditsSDK } from '@sparked/credits-sdk';

export const credits = new CreditsSDK({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
  options: {
    defaultCredits: 100,
  },
});
```

---

## App Integration

### app.sparked.world (Chat - Fixed Cost)

**File: `app/api/chat/route.ts`**

```typescript
import { credits } from '@/lib/credits';
import { auth } from '@clerk/nextjs';
import { FIXED_PRICING } from '@sparked/credits-sdk';

export async function POST(req: Request) {
  const { userId } = auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Deduct credits BEFORE processing (fail fast)
    const result = await credits.deduct(
      userId,
      FIXED_PRICING.chat_message, // 10 credits
      'chat_message',
      {
        app: 'app.sparked.world',
        model: 'claude-sonnet-4',
      }
    );

    // Process the chat message
    const response = await processChatMessage(req);

    return Response.json({
      ...response,
      credits_remaining: result.balance,
    });
  } catch (error) {
    if (error.name === 'InsufficientCreditsError') {
      return Response.json(
        {
          error: 'Insufficient credits',
          required: error.required,
          available: error.available,
        },
        { status: 402 }
      );
    }
    throw error;
  }
}
```

### canvas.sparked.world (Canvas - Fixed Cost)

**File: `app/api/canvas/generate/route.ts`**

```typescript
import { credits } from '@/lib/credits';
import { auth } from '@clerk/nextjs';
import { FIXED_PRICING } from '@sparked/credits-sdk';

export async function POST(req: Request) {
  const { userId } = auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { complexity } = await req.json();

  const cost =
    complexity === 'high'
      ? FIXED_PRICING.canvas_generation_complex // 75
      : FIXED_PRICING.canvas_generation_simple; // 50

  try {
    await credits.deduct(userId, cost, 'canvas_generation', {
      app: 'canvas.sparked.world',
      complexity,
    });

    const canvas = await generateCanvas(req);

    return Response.json({ canvas });
  } catch (error) {
    if (error.name === 'InsufficientCreditsError') {
      return Response.json(
        {
          error: 'Insufficient credits',
          required: error.required,
          available: error.available,
        },
        { status: 402 }
      );
    }
    throw error;
  }
}
```

### studio.sparked.world (Video - Metered)

**File: `app/api/video/generate/route.ts`**

```typescript
import { credits } from '@/lib/credits';
import { auth } from '@clerk/nextjs';
import { PricingEngine } from '@sparked/credits-sdk';

const pricing = new PricingEngine();

export async function POST(req: Request) {
  const { userId } = auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { duration, resolution } = await req.json();

  // Calculate cost based on video duration
  const cost = pricing.calculateCost('video_generation', duration);

  // Pre-check balance before expensive operation
  const balance = await credits.getBalance(userId);
  if (balance < cost) {
    return Response.json(
      {
        error: 'Insufficient credits',
        estimated_cost: cost,
        available: balance,
      },
      { status: 402 }
    );
  }

  try {
    await credits.deduct(userId, cost, 'video_generation', {
      app: 'studio.sparked.world',
      duration,
      resolution,
      credits_per_second: 10,
    });

    const video = await generateVideo({ duration, resolution });

    return Response.json({ video });
  } catch (error) {
    if (error.name === 'InsufficientCreditsError') {
      return Response.json(
        {
          error: 'Insufficient credits',
          required: error.required,
        },
        { status: 402 }
      );
    }
    throw error;
  }
}
```

### train.sparked.world (Training - Metered, Post-Charge)

**File: `app/api/train/start/route.ts`**

```typescript
import { credits } from '@/lib/credits';
import { auth } from '@clerk/nextjs';
import { PricingEngine } from '@sparked/credits-sdk';

const pricing = new PricingEngine();

export async function POST(req: Request) {
  const { userId } = auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { modelType, epochs } = await req.json();

  // Estimate cost
  const estimatedHours = estimateTrainingTime(modelType, epochs);
  const estimatedCost = pricing.calculateCost('training_job', estimatedHours);

  // Check balance before starting
  const balance = await credits.getBalance(userId);
  if (balance < estimatedCost) {
    return Response.json(
      {
        error: 'Insufficient credits',
        estimated_cost: estimatedCost,
        available: balance,
      },
      { status: 402 }
    );
  }

  // Start job (charge when complete via webhook)
  const job = await startTrainingJob({ userId, modelType, epochs });

  return Response.json({
    job_id: job.id,
    estimated_cost: estimatedCost,
    message: 'Will be charged when training completes',
  });
}
```

**File: `app/api/train/webhook/route.ts`**

```typescript
import { credits } from '@/lib/credits';
import { PricingEngine } from '@sparked/credits-sdk';

const pricing = new PricingEngine();

export async function POST(req: Request) {
  const { jobId, status, metrics } = await req.json();

  if (status === 'completed') {
    const job = await getTrainingJob(jobId);
    const actualCost = pricing.calculateCost('training_job', metrics.gpu_hours);

    try {
      await credits.deduct(job.userId, actualCost, 'training_completed', {
        app: 'train.sparked.world',
        job_id: jobId,
        gpu_hours: metrics.gpu_hours,
        estimated_hours: job.estimatedHours,
      });

      return Response.json({ success: true });
    } catch (error) {
      if (error.name === 'InsufficientCreditsError') {
        // User ran out during training - handle gracefully
        await pauseTraining(jobId);
        await notifyUser(job.userId, 'Training paused: insufficient credits');

        return Response.json(
          { error: 'Insufficient credits', paused: true },
          { status: 402 }
        );
      }
      throw error;
    }
  }

  return Response.json({ success: true });
}
```

---

## Clerk Webhook Setup

### 1. Create Webhook Handler

Create in **any one app** (or all for redundancy):

**File: `app/api/webhooks/clerk/route.ts`**

```typescript
import { Webhook } from 'svix';
import { headers } from 'next/headers';
import { credits } from '@/lib/credits';

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    throw new Error('Missing CLERK_WEBHOOK_SECRET');
  }

  // Get headers
  const headerPayload = headers();
  const svix_id = headerPayload.get('svix-id');
  const svix_timestamp = headerPayload.get('svix-timestamp');
  const svix_signature = headerPayload.get('svix-signature');

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response('Error: Missing svix headers', { status: 400 });
  }

  // Get body
  const payload = await req.json();
  const body = JSON.stringify(payload);

  // Verify webhook
  const wh = new Webhook(WEBHOOK_SECRET);
  let evt;

  try {
    evt = wh.verify(body, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    });
  } catch (err) {
    console.error('Webhook verification failed:', err);
    return new Response('Error: Verification failed', { status: 400 });
  }

  // Handle user.created event
  if (evt.type === 'user.created') {
    const { id } = evt.data;

    try {
      await credits.initializeUser(id, 100); // 100 free credits
      console.log(`✓ Initialized credits for user ${id}`);
    } catch (error) {
      console.error(`✗ Failed to initialize credits for user ${id}:`, error);
    }
  }

  return new Response('Webhook processed', { status: 200 });
}
```

### 2. Configure Clerk Webhook

1. Go to [Clerk Dashboard](https://dashboard.clerk.com)
2. Navigate to Webhooks
3. Click "Add Endpoint"
4. Enter your webhook URL: `https://app.sparked.world/api/webhooks/clerk`
5. Subscribe to `user.created` event
6. Copy the signing secret to `CLERK_WEBHOOK_SECRET`

---

## API Route Examples

### Get Balance

**File: `app/api/credits/balance/route.ts`**

```typescript
import { credits } from '@/lib/credits';
import { auth } from '@clerk/nextjs';

export async function GET() {
  const { userId } = auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const balance = await credits.getBalance(userId);
  return Response.json({ balance });
}
```

### Get Transaction History

**File: `app/api/credits/history/route.ts`**

```typescript
import { credits } from '@/lib/credits';
import { auth } from '@clerk/nextjs';

export async function GET(req: Request) {
  const { userId } = auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get('limit') || '50');

  const transactions = await credits.getTransactions(userId, { limit });

  return Response.json({ transactions });
}
```

### Admin Grant Credits

**File: `app/api/admin/credits/grant/route.ts`**

```typescript
import { credits } from '@/lib/credits';
import { auth, clerkClient } from '@clerk/nextjs';

export async function POST(req: Request) {
  const { userId } = auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check if user is admin
  const user = await clerkClient.users.getUser(userId);
  const isAdmin = user.publicMetadata.role === 'admin';

  if (!isAdmin) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { targetUserId, amount, reason } = await req.json();

  const result = await credits.add(targetUserId, amount, reason, {
    granted_by: userId,
    admin_action: true,
  });

  return Response.json(result);
}
```

---

## UI Components

### Credits Balance Widget

**File: `components/credits-balance.tsx`**

```typescript
'use client';

import { useEffect, useState } from 'react';

export function CreditsBalance() {
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBalance();
  }, []);

  const fetchBalance = async () => {
    try {
      const res = await fetch('/api/credits/balance');
      const data = await res.json();
      setBalance(data.balance);
    } catch (error) {
      console.error('Failed to fetch balance:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse bg-muted rounded-lg px-3 py-1 w-24 h-8" />
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1 bg-muted rounded-lg">
      <span className="text-sm text-muted-foreground">Credits:</span>
      <span className="font-semibold text-lg tabular-nums">{balance}</span>
    </div>
  );
}
```

Usage in layout:

```typescript
import { CreditsBalance } from '@/components/credits-balance';

export default function Layout({ children }) {
  return (
    <div>
      <header>
        <CreditsBalance />
      </header>
      {children}
    </div>
  );
}
```

### Transaction History

**File: `components/transaction-history.tsx`**

```typescript
'use client';

import { useEffect, useState } from 'react';
import type { Transaction } from '@sparked/credits-sdk';

export function TransactionHistory() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTransactions();
  }, []);

  const fetchTransactions = async () => {
    try {
      const res = await fetch('/api/credits/history?limit=20');
      const data = await res.json();
      setTransactions(data.transactions);
    } catch (error) {
      console.error('Failed to fetch transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold">Transaction History</h2>
      <div className="divide-y">
        {transactions.map((tx) => (
          <div key={tx.id} className="py-2 flex justify-between">
            <div>
              <div className="font-medium">{tx.action}</div>
              <div className="text-sm text-muted-foreground">
                {new Date(tx.timestamp).toLocaleString()}
              </div>
            </div>
            <div
              className={`font-semibold ${
                tx.amount > 0 ? 'text-green-600' : 'text-red-600'
              }`}
            >
              {tx.amount > 0 ? '+' : ''}
              {tx.amount}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## Monitoring & Reconciliation

### Reconciliation Script

**File: `scripts/reconcile-balances.ts`**

```typescript
import { CreditsSDK } from '@sparked/credits-sdk';
import { clerkClient } from '@clerk/nextjs';

const credits = new CreditsSDK({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
});

async function reconcileAll() {
  console.log('Starting balance reconciliation...');

  // Get all user IDs from Clerk
  const users = await clerkClient.users.getUserList({ limit: 500 });
  const userIds = users.map((u) => u.id);

  let fixed = 0;
  let errors = 0;
  let verified = 0;

  for (const userId of userIds) {
    try {
      const verification = await credits.verifyBalance(userId);

      if (!verification.valid) {
        console.log(
          `Fixing ${userId}: ${verification.cached} → ${verification.calculated}`
        );
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

  console.log(`
Reconciliation complete:
  ✓ Verified: ${verified}
  ✓ Fixed: ${fixed}
  ✗ Errors: ${errors}
  `);
}

reconcileAll();
```

### Cron Job Setup (Vercel)

**File: `vercel.json`**

```json
{
  "crons": [
    {
      "path": "/api/cron/reconcile",
      "schedule": "0 */6 * * *"
    }
  ]
}
```

**File: `app/api/cron/reconcile/route.ts`**

```typescript
import { NextRequest } from 'next/server';
import { CreditsSDK } from '@sparked/credits-sdk';

const credits = new CreditsSDK({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
});

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Run reconciliation (import logic from script)
  await reconcileAll();

  return Response.json({ success: true });
}
```

---

## Testing

### End-to-End Test

```typescript
// tests/credits-e2e.test.ts
import { test, expect } from '@playwright/test';

test('credits flow across apps', async ({ page }) => {
  // 1. Sign up on app.sparked.world
  await page.goto('https://app.sparked.world/sign-up');
  await signUp(page);

  // 2. Verify initial balance
  const balance = await page.locator('[data-testid="credits-balance"]');
  await expect(balance).toHaveText('100');

  // 3. Use chat (10 credits)
  await page.goto('https://app.sparked.world/chat');
  await sendMessage(page, 'Hello');
  await expect(balance).toHaveText('90');

  // 4. Generate canvas on different app (50 credits)
  await page.goto('https://canvas.sparked.world');
  await generateCanvas(page);
  await expect(balance).toHaveText('40');

  // 5. Verify balance is synced across apps
  await page.goto('https://studio.sparked.world');
  const studioBalance = await page.locator('[data-testid="credits-balance"]');
  await expect(studioBalance).toHaveText('40');
});
```

---

## Summary

This integration provides:

- ✅ Shared balance across 4 independent Next.js apps
- ✅ Atomic operations preventing race conditions
- ✅ Fixed costs for chat/canvas (simple, predictable)
- ✅ Metered costs for video/training (fair, usage-based)
- ✅ Automatic user initialization via Clerk webhooks
- ✅ Balance reconciliation for data integrity
- ✅ Admin tools for managing credits

For questions or issues, refer to the main [README.md](./README.md).
