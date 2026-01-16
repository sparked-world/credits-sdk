### The Problem

**Current State:**
You have 4 Next.js applications running as microfrontends:
- `app.sparked.world` - Main chat/AI interactions
- `canvas.sparked.world` - Collaborative canvas/whiteboard
- `studio.sparked.world` - Video/content generation
- `train.sparked.world` - AI model training/fine-tuning

Each has:
- ✅ Its own PostgreSQL database
- ✅ Clerk authentication (shared via SSO)
- ✅ Independent deployment

**New Requirement:**
Implement a **usage-based credits system** where:
- Users consume credits for AI operations across all apps:
  - `app.sparked.world`: Chat messages, AI responses
  - `canvas.sparked.world`: AI-generated canvas elements, real-time AI assistance
  - `studio.sparked.world`: Video generation, image creation, content synthesis
  - `train.sparked.world`: Model training jobs, fine-tuning runs
- Credits need to be **shared across all 4 apps**
- One user = one balance, regardless of which app they use

**The Core Challenge:**

```
User has 1000 credits total
├─ Uses 50 credits in app.sparked.world (10 chat messages @ 5 credits each)
├─ Uses 200 credits in canvas.sparked.world (AI canvas generation)
├─ Uses 500 credits in studio.sparked.world (video generation)
├─ Uses 100 credits in train.sparked.world (model fine-tuning)
└─ Has 150 credits remaining across ALL apps

How do we maintain a single source of truth?
```

**Why Traditional Approaches Don't Work:**

❌ **Option A: Use one app's database**
```
Problem: Other 3 apps need direct database access
- Which app "owns" credits? app.sparked.world?
- Other apps (canvas, studio, train) need direct DB credentials
- Tight coupling breaks microservices pattern
- What if app.sparked.world is down? No credits for anyone
```

❌ **Option B: Duplicate credits table in each database**
```
Problem: Synchronization nightmare
- User has 1000 in app, 1000 in canvas, 1000 in studio, 1000 in train
- User spends 500 in studio → how do other 3 apps know?
- Race condition: User uses canvas + studio simultaneously
- Eventually consistent = users can overspend 4x their actual balance
```

❌ **Option C: Use Clerk user metadata**
```
Problem: Not designed for high-frequency updates
- Rate limits (100 requests/10 seconds)
- train.sparked.world doing a long training job = many updates
- studio.sparked.world generating video = continuous deductions
- Concurrent updates = data loss
- No transaction guarantees
```

❌ **Option D: Use Lago/Metronome/Orb**
```
Problem: Massive overkill
- 7+ services to manage
- Built for complex billing (invoices, taxes, subscriptions)
- You just need: "deduct X credits, check balance"
- 8+ hours setup time for features you won't use
```

---

### The Solution: Event Sourcing with Redis

**Core Concept:** Treat credits like **blockchain transactions** - immutable log of all changes, balance is derived.

#### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    User (userId: abc123)                     │
│                  Total Balance: 1000 credits                 │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌──────────────┐      ┌──────────────┐     ┌──────────────┐
│app.sparked   │      │canvas.sparked│     │studio.sparked│
│  Chat/AI     │      │  Whiteboard  │     │    Video     │
│ -5 per msg   │      │ -200 per gen │     │ -500 per vid │
└──────────────┘      └──────────────┘     └──────────────┘
        │                     │                     │
        │              ┌──────────────┐            │
        │              │train.sparked │            │
        │              │ Fine-tuning  │            │
        │              │-100 per job  │            │
        │              └──────────────┘            │
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
                              ▼
                ┌─────────────────────────────┐
                │   @sparked/credits-sdk      │
                │   (Shared npm package)      │
                │   Same API for all apps     │
                └─────────────────────────────┘
                              │
                              ▼
                ┌─────────────────────────────┐
                │      Upstash Redis          │
                │   (Single source of truth)  │
                ├─────────────────────────────┤
                │ Key: balance:abc123         │
                │ Value: 1000                 │
                ├─────────────────────────────┤
                │ Key: txs:abc123 (sorted set)│
                │ ├─ [ts] +1000 "purchase"    │
                │ ├─ [ts] -5 "chat_msg"       │
                │ ├─ [ts] -200 "canvas_gen"   │
                │ ├─ [ts] -500 "video_gen"    │
                │ └─ [ts] -100 "model_train"  │
                └─────────────────────────────┘
```

#### Credit Cost Structure (Example)

```typescript
// Credit costs per operation (you define these)
const CREDIT_COSTS = {
  // app.sparked.world
  chat_message: 5,
  ai_response: 10,
  long_context: 20,
  
  // canvas.sparked.world
  canvas_ai_element: 50,
  canvas_generation: 200,
  realtime_ai_assist: 2, // per minute
  
  // studio.sparked.world
  image_generation: 100,
  video_generation: 500,
  audio_synthesis: 150,
  content_remix: 300,
  
  // train.sparked.world
  model_fine_tune: 1000,
  dataset_processing: 100,
  training_epoch: 50, // per epoch
  model_evaluation: 25,
};
```

#### How It Works

**1. Single Source of Truth**
```
All 4 apps → Same Redis instance → One balance per user
```

**2. Event Sourcing Pattern**
```
Don't store balance directly - store transaction log
Balance = SUM(all transactions)

Like blockchain:
├─ Transaction log = immutable (blocks)
├─ Balance = derived state (UTXO set)
└─ Can always verify by recalculating
```

**3. Fast Reads, Safe Writes**
```typescript
// Data structure in Redis:

balance:user123 → 1000           // Cached balance (O(1) read)

txs:user123 → [                  // Transaction log (sorted set)
  {
    id: "1234-abc",
    amount: +1000,
    action: "purchase",
    app: "checkout",
    timestamp: 1705401600000
  },
  {
    id: "1235-def", 
    amount: -5,
    action: "chat_message",
    app: "app.sparked.world",
    timestamp: 1705401700000
  },
  {
    id: "1236-ghi",
    amount: -200,
    action: "canvas_generation",
    app: "canvas.sparked.world",
    timestamp: 1705401800000
  },
  {
    id: "1237-jkl",
    amount: -500,
    action: "video_generation",
    app: "studio.sparked.world",
    timestamp: 1705401900000
  },
  {
    id: "1238-mno",
    amount: -100,
    action: "model_fine_tune",
    app: "train.sparked.world",
    timestamp: 1705402000000
  }
]
```

---

### Real-World Usage Examples

#### Example 1: Chat in app.sparked.world

```typescript
// app.sparked.world/app/api/chat/route.ts
import { credits } from '@/lib/credits';

export async function POST(req: Request) {
  const { userId } = auth();
  const { message } = await req.json();

  try {
    // Deduct 5 credits for chat message
    await credits.deduct(userId, 5, 'chat_message', {
      app: 'app.sparked.world',
      messageLength: message.length,
    });

    // Process chat...
    const response = await processChatMessage(message);

    return Response.json({ response });
    
  } catch (error) {
    if (error.name === 'InsufficientCreditsError') {
      return Response.json(
        { error: 'Not enough credits. Need 5 credits.' },
        { status: 402 }
      );
    }
    throw error;
  }
}
```

#### Example 2: Canvas Generation in canvas.sparked.world

```typescript
// canvas.sparked.world/app/api/canvas/generate/route.ts
import { credits } from '@/lib/credits';

export async function POST(req: Request) {
  const { userId } = auth();
  const { prompt, complexity } = await req.json();

  // Variable cost based on complexity
  const cost = complexity === 'high' ? 300 : 200;

  try {
    await credits.deduct(userId, cost, 'canvas_generation', {
      app: 'canvas.sparked.world',
      prompt,
      complexity,
    });

    const canvasData = await generateCanvas(prompt, complexity);
    
    return Response.json({ canvasData });
    
  } catch (error) {
    if (error.name === 'InsufficientCreditsError') {
      return Response.json(
        { 
          error: `Not enough credits. Need ${cost} credits.`,
          required: cost,
          available: error.available,
        },
        { status: 402 }
      );
    }
    throw error;
  }
}
```

#### Example 3: Video Generation in studio.sparked.world

```typescript
// studio.sparked.world/app/api/video/generate/route.ts
import { credits } from '@/lib/credits';

export async function POST(req: Request) {
  const { userId } = auth();
  const { duration, resolution } = await req.json();

  // Cost scales with video parameters
  const baseCost = 500;
  const durationMultiplier = duration / 60; // per minute
  const resolutionMultiplier = resolution === '4k' ? 2 : 1;
  const totalCost = Math.ceil(baseCost * durationMultiplier * resolutionMultiplier);

  try {
    // Check balance first (before expensive video generation)
    const balance = await credits.getBalance(userId);
    
    if (balance < totalCost) {
      return Response.json(
        { 
          error: 'Insufficient credits',
          required: totalCost,
          available: balance,
        },
        { status: 402 }
      );
    }

    // Deduct upfront
    await credits.deduct(userId, totalCost, 'video_generation', {
      app: 'studio.sparked.world',
      duration,
      resolution,
      estimatedCost: totalCost,
    });

    // Generate video (long-running operation)
    const videoJob = await startVideoGeneration({ duration, resolution });
    
    return Response.json({ 
      jobId: videoJob.id,
      creditsDeducted: totalCost,
    });
    
  } catch (error) {
    // Handle errors...
  }
}
```

#### Example 4: Model Training in train.sparked.world

```typescript
// train.sparked.world/app/api/train/start/route.ts
import { credits } from '@/lib/credits';

export async function POST(req: Request) {
  const { userId } = auth();
  const { modelType, epochs, datasetSize } = await req.json();

  // Training costs: base + per epoch + dataset processing
  const baseCost = 1000;
  const epochCost = epochs * 50;
  const datasetCost = Math.ceil(datasetSize / 1000) * 10;
  const totalCost = baseCost + epochCost + datasetCost;

  try {
    // Check balance before starting expensive training
    const balance = await credits.getBalance(userId);
    
    if (balance < totalCost) {
      return Response.json(
        { 
          error: 'Insufficient credits for training job',
          breakdown: {
            base: baseCost,
            epochs: epochCost,
            dataset: datasetCost,
            total: totalCost,
          },
          available: balance,
          shortfall: totalCost - balance,
        },
        { status: 402 }
      );
    }

    // Deduct credits upfront (training takes time)
    await credits.deduct(userId, totalCost, 'model_fine_tune', {
      app: 'train.sparked.world',
      modelType,
      epochs,
      datasetSize,
      breakdown: { baseCost, epochCost, datasetCost },
    });

    // Start training job
    const trainingJob = await startTraining({
      userId,
      modelType,
      epochs,
      datasetSize,
    });
    
    return Response.json({ 
      jobId: trainingJob.id,
      creditsDeducted: totalCost,
      estimatedCompletion: trainingJob.estimatedTime,
    });
    
  } catch (error) {
    // If training fails to start, refund credits
    if (error.code === 'TRAINING_FAILED') {
      await credits.add(userId, totalCost, 'training_refund', {
        app: 'train.sparked.world',
        reason: error.message,
      });
    }
    throw error;
  }
}
```

---

### Cross-App Usage Scenario

**Timeline of user activity:**

```
10:00 AM - User logs into app.sparked.world
         - Balance: 1000 credits

10:05 AM - Sends 10 chat messages in app.sparked.world
         - Cost: 10 × 5 = 50 credits
         - Balance: 950 credits

10:15 AM - Switches to canvas.sparked.world (same browser session)
         - SDK reads same balance: 950 credits

10:20 AM - Generates AI canvas element
         - Cost: 200 credits
         - Balance: 750 credits

10:30 AM - Opens studio.sparked.world in new tab
         - SDK reads same balance: 750 credits

10:35 AM - Starts video generation (60 sec, HD)
         - Cost: 500 credits
         - Balance: 250 credits

10:45 AM - Opens train.sparked.world
         - SDK reads same balance: 250 credits
         - Tries to start model training (costs 1000)
         - ❌ InsufficientCreditsError: need 1000, have 250

All apps see the same balance in real-time!
```

---

### Why This Solution Wins for Your Specific Apps

#### ✅ **Works Across Your Entire Ecosystem**

```
app.sparked.world    → Frequent, small deductions (chat)
canvas.sparked.world → Medium deductions (AI generation)
studio.sparked.world → Large deductions (video/content)
train.sparked.world  → Very large deductions (model training)

All use the SAME SDK, SAME API, SAME balance
```

#### ✅ **Handles Different Usage Patterns**

| App | Pattern | SDK Advantage |
|-----|---------|---------------|
| app.sparked | High frequency, low cost | Fast reads (5ms) |
| canvas.sparked | Medium frequency, medium cost | Real-time balance updates |
| studio.sparked | Low frequency, high cost | Upfront balance check |
| train.sparked | Very low frequency, very high cost | Pre-validation before expensive ops |

#### ✅ **Built-in Refund Logic**

```typescript
// In train.sparked.world - if training job fails
await credits.add(userId, 1000, 'training_job_failed', {
  jobId: trainingJob.id,
  reason: 'GPU allocation failed',
});

// In studio.sparked.world - if video generation fails
await credits.add(userId, 500, 'video_generation_failed', {
  jobId: videoJob.id,
  reason: 'Rendering timeout',
});

// Audit trail automatically includes refunds
```

#### ✅ **Per-App Analytics**

```typescript
// Query transactions by app
const appTransactions = await credits.getTransactions(userId);

const byApp = appTransactions.reduce((acc, tx) => {
  const app = tx.metadata.app || 'unknown';
  acc[app] = (acc[app] || 0) + Math.abs(tx.amount);
  return acc;
}, {});

// Result:
// {
//   'app.sparked.world': 250,      // 50 chat messages
//   'canvas.sparked.world': 600,   // 3 generations
//   'studio.sparked.world': 1500,  // 3 videos
//   'train.sparked.world': 3000,   // 3 training jobs
// }
```

---

### Updated Implementation Plan

The core implementation plan remains the same, but with **app-specific integration examples**:

**Phase 2: Integration Layer** becomes:

```
Day 2-3: Integrate SDK into all 4 apps
├─ app.sparked.world
│  └─ Integrate in: /api/chat, /api/generate
├─ canvas.sparked.world  
│  └─ Integrate in: /api/canvas/generate, /api/realtime
├─ studio.sparked.world
│  └─ Integrate in: /api/video/generate, /api/image/generate
└─ train.sparked.world
   └─ Integrate in: /api/train/start, /api/train/evaluate
```

---

### Cost Estimates Updated

**Based on 1000 active users across 4 apps:**

```
Average usage per user per day:
- app.sparked: 20 chat messages = 100 credits = 20 credit operations
- canvas.sparked: 2 generations = 400 credits = 2 credit operations  
- studio.sparked: 1 video = 500 credits = 1 credit operation
- train.sparked: 0.1 training job = 100 credits = 0.1 credit operations

Total per user: ~25 credit operations/day
Total for 1000 users: ~25,000 operations/day
Total per month: ~750,000 operations

Upstash Redis cost:
Free tier: 10,000 commands/day (covers ~400 users)
Paid tier ($10/mo): 1,000,000 commands/month (covers your needs)
```

---

### The Bottom Line (Updated)

**Problem:** 4 diverse apps (chat, canvas, video, training) need to share credits without tight coupling.

**Solution:** Event-sourced credits SDK that works identically across all apps, regardless of usage pattern.

**Why it works for Sparked:**
- ✅ **app.sparked**: Fast enough for real-time chat (5-10ms)
- ✅ **canvas.sparked**: Real-time balance updates for collaborative sessions
- ✅ **studio.sparked**: Pre-check balance before expensive video jobs
- ✅ **train.sparked**: Validate credits before long-running training jobs

**Result:** One SDK, four apps, single source of truth, zero reconciliation.

---

## Implementation Plan: Credits SDK System

### Phase 1: Core SDK Development (Day 1-2)

#### 1.1 Setup Package Structure
```bash
# Create package
sparked/
├── packages/
│   └── credits-sdk/
│       ├── src/
│       │   ├── index.ts          # Main SDK export
│       │   ├── client.ts         # CreditsSDK class
│       │   ├── types.ts          # TypeScript interfaces
│       │   └── errors.ts         # Custom error classes
│       ├── package.json
│       ├── tsconfig.json
│       └── README.md
```

#### 1.2 Core SDK Implementation

**File: `packages/credits-sdk/src/types.ts`**
```typescript
export interface CreditsConfig {
  url: string;
  token: string;
  options?: {
    enableBackup?: boolean;
    defaultCredits?: number;
  };
}

export interface Transaction {
  id: string;
  amount: number;
  metadata: {
    action: string;
    [key: string]: any;
  };
  timestamp: number;
}

export interface TransactionResult {
  txId: string;
  balance: number;
  timestamp: number;
}

export interface GetTransactionsOptions {
  limit?: number;
  before?: number;
  after?: number;
}
```

**File: `packages/credits-sdk/src/errors.ts`**
```typescript
export class InsufficientCreditsError extends Error {
  constructor(
    public required: number,
    public available: number
  ) {
    super(`Insufficient credits: required ${required}, available ${available}`);
    this.name = 'InsufficientCreditsError';
  }
}

export class TransactionError extends Error {
  constructor(message: string, public txId?: string) {
    super(message);
    this.name = 'TransactionError';
  }
}
```

**File: `packages/credits-sdk/src/client.ts`**
```typescript
import { Redis } from '@upstash/redis';
import type {
  CreditsConfig,
  Transaction,
  TransactionResult,
  GetTransactionsOptions
} from './types';
import { InsufficientCreditsError, TransactionError } from './errors';

export class CreditsSDK {
  private redis: Redis;
  private options: CreditsConfig['options'];

  constructor(config: CreditsConfig) {
    this.redis = new Redis({
      url: config.url,
      token: config.token,
    });
    this.options = config.options || {};
  }

  /**
   * Add transaction (internal method)
   */
  private async addTransaction(
    userId: string,
    amount: number,
    metadata: { action: string; [key: string]: any }
  ): Promise<TransactionResult> {
    const txId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const timestamp = Date.now();

    const transaction: Transaction = {
      id: txId,
      amount,
      metadata,
      timestamp,
    };

    try {
      // Atomic operation: add to log + update balance
      const pipeline = this.redis.pipeline();

      // 1. Append to immutable transaction log
      pipeline.zadd(`txs:${userId}`, {
        score: timestamp,
        member: JSON.stringify(transaction),
      });

      // 2. Update cached balance
      pipeline.incrby(`balance:${userId}`, amount);

      const [_, newBalance] = await pipeline.exec();

      return {
        txId,
        balance: newBalance as number,
        timestamp,
      };
    } catch (error) {
      throw new TransactionError(
        `Failed to add transaction: ${error.message}`,
        txId
      );
    }
  }

  /**
   * Get current balance
   */
  async getBalance(userId: string): Promise<number> {
    const balance = await this.redis.get(`balance:${userId}`);

    // Cache miss - rebuild from transactions
    if (balance === null) {
      return await this.rebuildBalance(userId);
    }

    return Number(balance);
  }

  /**
   * Deduct credits with validation
   */
  async deduct(
    userId: string,
    amount: number,
    action: string,
    metadata?: Record<string, any>
  ): Promise<TransactionResult> {
    // Validate amount
    if (amount <= 0) {
      throw new Error('Deduct amount must be positive');
    }

    // Check sufficient balance
    const balance = await this.getBalance(userId);

    if (balance < amount) {
      throw new InsufficientCreditsError(amount, balance);
    }

    // Add negative transaction
    return await this.addTransaction(userId, -amount, {
      action,
      ...metadata,
    });
  }

  /**
   * Add credits
   */
  async add(
    userId: string,
    amount: number,
    reason: string,
    metadata?: Record<string, any>
  ): Promise<TransactionResult> {
    // Validate amount
    if (amount <= 0) {
      throw new Error('Add amount must be positive');
    }

    return await this.addTransaction(userId, amount, {
      action: reason,
      ...metadata,
    });
  }

  /**
   * Get transaction history
   */
  async getTransactions(
    userId: string,
    options: GetTransactionsOptions = {}
  ): Promise<Transaction[]> {
    const { limit = 100, before, after } = options;

    let txs: string[];

    if (before) {
      // Get transactions before timestamp
      txs = await this.redis.zrange(`txs:${userId}`, 0, before, {
        byScore: true,
        rev: true,
        count: limit,
      });
    } else if (after) {
      // Get transactions after timestamp
      txs = await this.redis.zrange(`txs:${userId}`, after, '+inf', {
        byScore: true,
        count: limit,
      });
    } else {
      // Get most recent transactions
      txs = await this.redis.zrange(`txs:${userId}`, -limit, -1);
    }

    return txs.map((tx) => JSON.parse(tx as string));
  }

  /**
   * Rebuild balance from transaction log (like blockchain sync)
   */
  async rebuildBalance(userId: string): Promise<number> {
    const transactions = await this.redis.zrange(`txs:${userId}`, 0, -1);

    const balance = transactions.reduce((sum, tx) => {
      const parsed = JSON.parse(tx as string);
      return sum + parsed.amount;
    }, 0);

    // Update cache
    await this.redis.set(`balance:${userId}`, balance);

    return balance;
  }

  /**
   * Verify balance matches transaction log
   */
  async verifyBalance(userId: string): Promise<{
    valid: boolean;
    cached: number;
    calculated: number;
  }> {
    const cached = await this.getBalance(userId);
    const transactions = await this.redis.zrange(`txs:${userId}`, 0, -1);

    const calculated = transactions.reduce((sum, tx) => {
      const parsed = JSON.parse(tx as string);
      return sum + parsed.amount;
    }, 0);

    return {
      valid: cached === calculated,
      cached,
      calculated,
    };
  }

  /**
   * Initialize user with starting balance
   */
  async initializeUser(userId: string, startingBalance?: number): Promise<void> {
    const balance = startingBalance ?? this.options.defaultCredits ?? 0;

    if (balance > 0) {
      await this.add(userId, balance, 'initial_balance');
    } else {
      // Just set balance to 0
      await this.redis.set(`balance:${userId}`, 0);
    }
  }

  /**
   * Get user stats
   */
  async getStats(userId: string): Promise<{
    balance: number;
    totalTransactions: number;
    totalSpent: number;
    totalAdded: number;
  }> {
    const [balance, transactions] = await Promise.all([
      this.getBalance(userId),
      this.redis.zrange(`txs:${userId}`, 0, -1),
    ]);

    let totalSpent = 0;
    let totalAdded = 0;

    transactions.forEach((tx) => {
      const parsed = JSON.parse(tx as string);
      if (parsed.amount < 0) {
        totalSpent += Math.abs(parsed.amount);
      } else {
        totalAdded += parsed.amount;
      }
    });

    return {
      balance,
      totalTransactions: transactions.length,
      totalSpent,
      totalAdded,
    };
  }
}
```

**File: `packages/credits-sdk/src/index.ts`**
```typescript
export { CreditsSDK } from './client';
export type {
  CreditsConfig,
  Transaction,
  TransactionResult,
  GetTransactionsOptions,
} from './types';
export { InsufficientCreditsError, TransactionError } from './errors';
```

**File: `packages/credits-sdk/package.json`**
```json
{
  "name": "@sparked/credits-sdk",
  "version": "1.0.0",
  "description": "Credits management SDK with event sourcing",
  "main": "./dist/index.js",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "require": "./dist/index.js",
      "import": "./dist/index.mjs",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format cjs,esm --dts --clean",
    "dev": "tsup src/index.ts --format cjs,esm --dts --watch",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@upstash/redis": "^1.34.3"
  },
  "devDependencies": {
    "tsup": "^8.0.1",
    "typescript": "^5.3.3"
  }
}
```

---

### Phase 2: Integration Layer (Day 2-3)

#### 2.1 Create Credits Service Wrapper

**File: `packages/credits-sdk/src/service.ts`** (optional abstraction layer)
```typescript
import { CreditsSDK } from './client';
import type { CreditsConfig } from './types';

// Singleton instance
let creditsInstance: CreditsSDK | null = null;

export function initializeCredits(config: CreditsConfig): CreditsSDK {
  if (!creditsInstance) {
    creditsInstance = new CreditsSDK(config);
  }
  return creditsInstance;
}

export function getCredits(): CreditsSDK {
  if (!creditsInstance) {
    throw new Error('Credits SDK not initialized. Call initializeCredits() first.');
  }
  return creditsInstance;
}

// Convenience functions
export async function deductCredits(
  userId: string,
  amount: number,
  action: string
) {
  return getCredits().deduct(userId, amount, action);
}

export async function addCredits(
  userId: string,
  amount: number,
  reason: string
) {
  return getCredits().add(userId, amount, reason);
}

export async function getBalance(userId: string) {
  return getCredits().getBalance(userId);
}
```

#### 2.2 Integration in Each App

**File: `apps/app/lib/credits.ts`** (repeat for each app)
```typescript
import { initializeCredits } from '@sparked/credits-sdk';

export const credits = initializeCredits({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
  options: {
    defaultCredits: 100, // Free tier credits
  },
});
```

#### 2.3 API Route Examples

**File: `apps/app/app/api/chat/route.ts`**
```typescript
import { credits } from '@/lib/credits';
import { auth } from '@clerk/nextjs';

export async function POST(req: Request) {
  const { userId } = auth();
  
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Check and deduct credits BEFORE processing
    const result = await credits.deduct(userId, 10, 'chat_message', {
      model: 'claude-sonnet-4',
      timestamp: Date.now(),
    });

    // Process chat...
    const response = await processChatMessage(req);

    return Response.json({
      ...response,
      creditsRemaining: result.balance,
    });
    
  } catch (error) {
    if (error.name === 'InsufficientCreditsError') {
      return Response.json(
        { 
          error: 'Insufficient credits',
          required: error.required,
          available: error.available,
        },
        { status: 402 } // Payment Required
      );
    }
    throw error;
  }
}
```

**File: `apps/research/app/api/research/route.ts`**
```typescript
import { credits } from '@/lib/credits';
import { auth } from '@clerk/nextjs';

export async function POST(req: Request) {
  const { userId } = auth();
  const body = await req.json();

  try {
    // Higher cost for research
    await credits.deduct(userId, 50, 'research_query', {
      query: body.query,
      depth: body.depth,
    });

    // Process research...
    
  } catch (error) {
    // Handle insufficient credits...
  }
}
```

**File: `apps/studio/app/api/video/generate/route.ts`**
```typescript
import { credits } from '@/lib/credits';
import { auth } from '@clerk/nextjs';

export async function POST(req: Request) {
  const { userId } = auth();

  try {
    // High cost for video generation
    await credits.deduct(userId, 200, 'video_generation', {
      duration: req.body.duration,
      resolution: req.body.resolution,
    });

    // Process video generation...
    
  } catch (error) {
    // Handle insufficient credits...
  }
}
```

---

### Phase 3: User-Facing Features (Day 3-4)

#### 3.1 Credits Display Component

**File: `apps/app/components/credits-balance.tsx`**
```typescript
'use client';

import { useEffect, useState } from 'react';

export function CreditsBalance() {
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/credits/balance')
      .then(res => res.json())
      .then(data => {
        setBalance(data.balance);
        setLoading(false);
      });
  }, []);

  if (loading) return <div>Loading...</div>;

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Credits:</span>
      <span className="font-semibold">{balance}</span>
    </div>
  );
}
```

#### 3.2 Credits API Routes

**File: `apps/app/app/api/credits/balance/route.ts`**
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

**File: `apps/app/app/api/credits/history/route.ts`**
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

**File: `apps/app/app/api/credits/stats/route.ts`**
```typescript
import { credits } from '@/lib/credits';
import { auth } from '@clerk/nextjs';

export async function GET() {
  const { userId } = auth();
  
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stats = await credits.getStats(userId);
  
  return Response.json(stats);
}
```

#### 3.3 Credits History Page

**File: `apps/app/app/credits/page.tsx`**
```typescript
import { credits } from '@/lib/credits';
import { auth } from '@clerk/nextjs';
import { redirect } from 'next/navigation';

export default async function CreditsPage() {
  const { userId } = auth();
  
  if (!userId) {
    redirect('/sign-in');
  }

  const [stats, transactions] = await Promise.all([
    credits.getStats(userId),
    credits.getTransactions(userId, { limit: 100 }),
  ]);

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-8">Credits</h1>
      
      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard title="Balance" value={stats.balance} />
        <StatCard title="Total Spent" value={stats.totalSpent} />
        <StatCard title="Total Added" value={stats.totalAdded} />
        <StatCard title="Transactions" value={stats.totalTransactions} />
      </div>

      <div className="bg-card rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Transaction History</h2>
        <TransactionsList transactions={transactions} />
      </div>
    </div>
  );
}
```

---

### Phase 4: Clerk Integration (Day 4-5)

#### 4.1 Webhook Handler for New Users

**File: `apps/app/app/api/webhooks/clerk/route.ts`**
```typescript
import { Webhook } from 'svix';
import { headers } from 'next/headers';
import { credits } from '@/lib/credits';

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    throw new Error('Missing CLERK_WEBHOOK_SECRET');
  }

  const headerPayload = headers();
  const svix_id = headerPayload.get('svix-id');
  const svix_timestamp = headerPayload.get('svix-timestamp');
  const svix_signature = headerPayload.get('svix-signature');

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response('Error: Missing svix headers', { status: 400 });
  }

  const payload = await req.json();
  const body = JSON.stringify(payload);

  const wh = new Webhook(WEBHOOK_SECRET);

  let evt;
  try {
    evt = wh.verify(body, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    });
  } catch (err) {
    return new Response('Error: Verification failed', { status: 400 });
  }

  const eventType = evt.type;

  if (eventType === 'user.created') {
    const { id } = evt.data;
    
    // Initialize user with free credits
    await credits.initializeUser(id, 100);
    
    console.log(`Initialized credits for user ${id}`);
  }

  return new Response('Webhook processed', { status: 200 });
}
```

#### 4.2 Subscription Integration

**File: `apps/app/app/api/webhooks/clerk-billing/route.ts`**
```typescript
import { credits } from '@/lib/credits';

export async function POST(req: Request) {
  // Handle Clerk billing webhooks
  const payload = await req.json();

  if (payload.type === 'subscription.created') {
    const { user_id, plan } = payload.data;
    
    // Add credits based on plan
    const creditsToAdd = {
      'basic': 500,
      'pro': 2000,
      'enterprise': 10000,
    }[plan] || 0;

    await credits.add(user_id, creditsToAdd, 'subscription_purchase', {
      plan,
      subscription_id: payload.data.id,
    });
  }

  if (payload.type === 'subscription.renewed') {
    const { user_id, plan } = payload.data;
    
    // Add monthly credits
    const creditsToAdd = {
      'basic': 500,
      'pro': 2000,
      'enterprise': 10000,
    }[plan] || 0;

    await credits.add(user_id, creditsToAdd, 'subscription_renewal', {
      plan,
      subscription_id: payload.data.id,
    });
  }

  return Response.json({ success: true });
}
```

---

### Phase 5: Admin Tools (Day 5)

#### 5.1 Admin API Routes

**File: `apps/app/app/api/admin/credits/grant/route.ts`**
```typescript
import { credits } from '@/lib/credits';
import { auth } from '@clerk/nextjs';

export async function POST(req: Request) {
  const { userId } = auth();
  
  // Check if user is admin
  // (implement your admin check logic)
  
  const { targetUserId, amount, reason } = await req.json();
  
  const result = await credits.add(targetUserId, amount, reason, {
    grantedBy: userId,
  });
  
  return Response.json(result);
}
```

**File: `apps/app/app/api/admin/credits/verify/route.ts`**
```typescript
import { credits } from '@/lib/credits';

export async function POST(req: Request) {
  const { userId: targetUserId } = await req.json();
  
  const verification = await credits.verifyBalance(targetUserId);
  
  if (!verification.valid) {
    // Auto-fix
    await credits.rebuildBalance(targetUserId);
  }
  
  return Response.json(verification);
}
```

---

### Phase 6: Testing & Deployment (Day 6-7)

#### 6.1 Unit Tests

**File: `packages/credits-sdk/tests/client.test.ts`**
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { CreditsSDK } from '../src/client';
import { InsufficientCreditsError } from '../src/errors';

describe('CreditsSDK', () => {
  let sdk: CreditsSDK;
  const testUserId = 'test-user-123';

  beforeEach(async () => {
    sdk = new CreditsSDK({
      url: process.env.UPSTASH_REDIS_URL!,
      token: process.env.UPSTASH_REDIS_TOKEN!,
    });
    
    // Clean up test user
    await sdk.rebuildBalance(testUserId);
  });

  it('should initialize user with starting balance', async () => {
    await sdk.initializeUser(testUserId, 100);
    const balance = await sdk.getBalance(testUserId);
    expect(balance).toBe(100);
  });

  it('should deduct credits successfully', async () => {
    await sdk.initializeUser(testUserId, 100);
    const result = await sdk.deduct(testUserId, 10, 'test_action');
    expect(result.balance).toBe(90);
  });

  it('should throw InsufficientCreditsError', async () => {
    await sdk.initializeUser(testUserId, 10);
    
    await expect(
      sdk.deduct(testUserId, 20, 'test_action')
    ).rejects.toThrow(InsufficientCreditsError);
  });

  it('should verify balance matches transactions', async () => {
    await sdk.initializeUser(testUserId, 100);
    await sdk.deduct(testUserId, 10, 'action1');
    await sdk.add(testUserId, 50, 'action2');
    
    const verification = await sdk.verifyBalance(testUserId);
    expect(verification.valid).toBe(true);
    expect(verification.cached).toBe(140);
  });
});
```

#### 6.2 Environment Setup

**File: `.env.example`**
```bash
# Upstash Redis
UPSTASH_REDIS_URL=https://your-redis.upstash.io
UPSTASH_REDIS_TOKEN=your_token_here

# Clerk
CLERK_WEBHOOK_SECRET=whsec_xxxxx
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxxxx
CLERK_SECRET_KEY=sk_test_xxxxx
```

#### 6.3 Deployment Checklist

- [ ] Set up Upstash Redis account
- [ ] Create production Redis database
- [ ] Add environment variables to all 4 apps
- [ ] Deploy SDK package (npm publish or git submodule)
- [ ] Configure Clerk webhooks
- [ ] Test in staging environment
- [ ] Monitor first 100 transactions
- [ ] Set up alerts for failed transactions

---

### Phase 7: Monitoring & Maintenance (Ongoing)

#### 7.1 Monitoring Script

**File: `scripts/monitor-credits.ts`**
```typescript
import { CreditsSDK } from '@sparked/credits-sdk';

const sdk = new CreditsSDK({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
});

async function monitorSystem() {
  // Check random sample of users
  const userIds = await getUserIds(); // implement this
  
  for (const userId of userIds.slice(0, 10)) {
    const verification = await sdk.verifyBalance(userId);
    
    if (!verification.valid) {
      console.error(`Balance mismatch for user ${userId}`, verification);
      // Alert via Slack/email
      // Auto-fix
      await sdk.rebuildBalance(userId);
    }
  }
}

// Run every hour
setInterval(monitorSystem, 60 * 60 * 1000);
```

---

## Timeline Summary

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| 1. Core SDK | 1-2 days | Working SDK package |
| 2. Integration | 1 day | Integrated in all 4 apps |
| 3. User Features | 1 day | UI for balance/history |
| 4. Clerk Integration | 1 day | Auto-initialization + subscriptions |
| 5. Admin Tools | 0.5 days | Grant/verify credits |
| 6. Testing | 1 day | Tests + staging deployment |
| 7. Production | 0.5 days | Production deployment |

**Total: 5-7 days**

---

Another approach:

## The Core Problem We're Solving

**Credits system says:**
```
"This action costs 500 credits"
```

**Metering system says:**
```
"This action used 1,542 tokens, 3.2 GPU seconds, 2 API calls"
→ Convert to cost: 1,542 * $0.001 + 3.2 * $0.10 + 2 * $0.50 = $2.86
→ Convert to credits: $2.86 * 100 = 286 credits
→ Deduct 286 credits
```

**Why metering is better for AI:**
- ✅ You track actual resource consumption
- ✅ You can change pricing without refactoring
- ✅ You can show users exactly what they used
- ✅ You can optimize costs (which operations are expensive?)
- ✅ You can do cost analysis (video vs. training vs. LLM)

---

## Architecture: Event Sourcing for Metering + Credits

### The Two-Layer System

```
Layer 1: Metering (tracks usage)
   ↓ converts via pricing rules
Layer 2: Credits (billing abstraction)
```

### Data Flow

```
User Action
    ↓
App records USAGE EVENT
    ↓
Metering System stores event
    ↓
Pricing Engine converts to COST
    ↓
Credits System deducts credits
    ↓
User sees: "Used 1,542 tokens (15 credits)"
```

---

## Implementation: Metering SDK Architecture

### Redis Data Structures

```typescript
// 1. RAW USAGE EVENTS (immutable log)
events:user123 → sorted set by timestamp
[
  {
    id: "evt_abc",
    timestamp: 1705401600000,
    app: "app.sparked.world",
    type: "llm.tokens",
    value: 1542,
    metadata: {
      model: "claude-sonnet-4",
      input_tokens: 150,
      output_tokens: 1392,
      conversation_id: "conv_xyz"
    }
  },
  {
    id: "evt_def",
    timestamp: 1705401700000,
    app: "studio.sparked.world", 
    type: "gpu.seconds",
    value: 127.3,
    metadata: {
      operation: "video_generation",
      resolution: "1080p",
      duration: 60
    }
  }
]

// 2. AGGREGATED METRICS (fast queries)
usage:user123:llm.tokens:daily:2025-01-16 → 45230
usage:user123:gpu.seconds:daily:2025-01-16 → 382.1
usage:user123:api.calls:monthly:2025-01 → 127

// 3. PRICING RULES (configurable)
pricing:llm.tokens → { rate: 0.01, unit: "per_token", credits_per_unit: 0.01 }
pricing:gpu.seconds → { rate: 2, unit: "per_second", credits_per_unit: 2 }
pricing:api.calls → { rate: 50, unit: "per_call", credits_per_unit: 50 }

// 4. CREDITS (existing system)
balance:user123 → 1000
txs:user123 → [...credit transactions with metering metadata...]
```

---

## Enhanced SDK: Metering + Credits

### File: `packages/metering-sdk/src/types.ts`

```typescript
export interface MeteringConfig {
  url: string;
  token: string;
  options?: {
    enableAggregation?: boolean;
    aggregationInterval?: number; // milliseconds
  };
}

export interface UsageEvent {
  id: string;
  userId: string;
  timestamp: number;
  app: string;
  type: string; // 'llm.tokens', 'gpu.seconds', 'api.calls'
  value: number;
  metadata?: Record<string, any>;
}

export interface PricingRule {
  type: string;
  rate: number; // credits per unit
  unit: string;
  description?: string;
  tiered?: {
    from: number;
    to: number;
    rate: number;
  }[];
}

export interface UsageSummary {
  type: string;
  total: number;
  cost: number; // in credits
  events: number;
  breakdown?: Record<string, any>;
}
```

### File: `packages/metering-sdk/src/metering.ts`

```typescript
import { Redis } from '@upstash/redis';
import type { MeteringConfig, UsageEvent, PricingRule, UsageSummary } from './types';

export class MeteringSDK {
  private redis: Redis;
  private options: MeteringConfig['options'];

  constructor(config: MeteringConfig) {
    this.redis = new Redis({
      url: config.url,
      token: config.token,
    });
    this.options = config.options || {};
  }

  /**
   * Record a usage event (core metering function)
   */
  async recordEvent(
    userId: string,
    app: string,
    type: string,
    value: number,
    metadata?: Record<string, any>
  ): Promise<UsageEvent> {
    const eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const timestamp = Date.now();

    const event: UsageEvent = {
      id: eventId,
      userId,
      timestamp,
      app,
      type,
      value,
      metadata,
    };

    const pipeline = this.redis.pipeline();

    // 1. Store raw event (immutable log)
    pipeline.zadd(`events:${userId}`, {
      score: timestamp,
      member: JSON.stringify(event),
    });

    // 2. Update daily aggregate
    const dateKey = new Date(timestamp).toISOString().split('T')[0];
    pipeline.incrbyfloat(`usage:${userId}:${type}:daily:${dateKey}`, value);

    // 3. Update monthly aggregate
    const monthKey = dateKey.substring(0, 7); // "2025-01"
    pipeline.incrbyfloat(`usage:${userId}:${type}:monthly:${monthKey}`, value);

    await pipeline.exec();

    return event;
  }

  /**
   * Get pricing rule for a usage type
   */
  async getPricingRule(type: string): Promise<PricingRule | null> {
    const rule = await this.redis.get(`pricing:${type}`);
    return rule ? JSON.parse(rule as string) : null;
  }

  /**
   * Set pricing rule for a usage type
   */
  async setPricingRule(rule: PricingRule): Promise<void> {
    await this.redis.set(`pricing:${rule.type}`, JSON.stringify(rule));
  }

  /**
   * Calculate cost for a usage value
   */
  async calculateCost(type: string, value: number): Promise<number> {
    const rule = await this.getPricingRule(type);
    
    if (!rule) {
      throw new Error(`No pricing rule found for type: ${type}`);
    }

    // Simple rate
    if (!rule.tiered) {
      return Math.ceil(value * rule.rate);
    }

    // Tiered pricing
    let cost = 0;
    let remaining = value;

    for (const tier of rule.tiered) {
      const tierSize = tier.to - tier.from;
      const consumed = Math.min(remaining, tierSize);
      cost += consumed * tier.rate;
      remaining -= consumed;

      if (remaining <= 0) break;
    }

    return Math.ceil(cost);
  }

  /**
   * Record usage and return calculated cost (in credits)
   */
  async recordAndCalculate(
    userId: string,
    app: string,
    type: string,
    value: number,
    metadata?: Record<string, any>
  ): Promise<{ event: UsageEvent; credits: number }> {
    // Record the event
    const event = await this.recordEvent(userId, app, type, value, metadata);

    // Calculate cost
    const credits = await this.calculateCost(type, value);

    return { event, credits };
  }

  /**
   * Get usage summary for a time period
   */
  async getUsageSummary(
    userId: string,
    startTime: number,
    endTime: number,
    types?: string[]
  ): Promise<UsageSummary[]> {
    // Get all events in time range
    const events = await this.redis.zrange(
      `events:${userId}`,
      startTime,
      endTime,
      { byScore: true }
    );

    // Group by type
    const grouped = new Map<string, { total: number; events: UsageEvent[] }>();

    for (const eventStr of events) {
      const event = JSON.parse(eventStr as string) as UsageEvent;

      if (types && !types.includes(event.type)) continue;

      if (!grouped.has(event.type)) {
        grouped.set(event.type, { total: 0, events: [] });
      }

      const group = grouped.get(event.type)!;
      group.total += event.value;
      group.events.push(event);
    }

    // Calculate costs
    const summaries: UsageSummary[] = [];

    for (const [type, data] of grouped.entries()) {
      const cost = await this.calculateCost(type, data.total);

      summaries.push({
        type,
        total: data.total,
        cost,
        events: data.events.length,
      });
    }

    return summaries;
  }

  /**
   * Get aggregated usage for a specific period
   */
  async getAggregatedUsage(
    userId: string,
    type: string,
    period: 'daily' | 'monthly',
    date: string // "2025-01-16" for daily, "2025-01" for monthly
  ): Promise<number> {
    const value = await this.redis.get(`usage:${userId}:${type}:${period}:${date}`);
    return value ? Number(value) : 0;
  }

  /**
   * Get raw events for debugging/audit
   */
  async getEvents(
    userId: string,
    startTime: number,
    endTime: number,
    limit = 100
  ): Promise<UsageEvent[]> {
    const events = await this.redis.zrange(
      `events:${userId}`,
      startTime,
      endTime,
      { byScore: true, count: limit }
    );

    return events.map(e => JSON.parse(e as string));
  }
}
```

---

## Combined SDK: Metering + Credits

### File: `packages/sparked-billing/src/index.ts`

```typescript
import { Redis } from '@upstash/redis';
import { MeteringSDK } from './metering';
import { CreditsSDK } from './credits';

export class BillingSDK {
  private metering: MeteringSDK;
  private credits: CreditsSDK;

  constructor(config: { url: string; token: string }) {
    this.metering = new MeteringSDK(config);
    this.credits = new CreditsSDK(config);
  }

  /**
   * Record usage and deduct credits in one operation
   */
  async recordAndCharge(
    userId: string,
    app: string,
    usageType: string,
    value: number,
    action: string,
    metadata?: Record<string, any>
  ): Promise<{
    event_id: string;
    usage_value: number;
    credits_charged: number;
    balance_remaining: number;
  }> {
    // 1. Record usage event + calculate cost
    const { event, credits: creditsToCharge } = await this.metering.recordAndCalculate(
      userId,
      app,
      usageType,
      value,
      metadata
    );

    // 2. Check if user has enough credits
    const balance = await this.credits.getBalance(userId);
    
    if (balance < creditsToCharge) {
      throw new InsufficientCreditsError(creditsToCharge, balance);
    }

    // 3. Deduct credits with metering metadata
    const result = await this.credits.deduct(userId, creditsToCharge, action, {
      app,
      usage_type: usageType,
      usage_value: value,
      event_id: event.id,
      ...metadata,
    });

    return {
      event_id: event.id,
      usage_value: value,
      credits_charged: creditsToCharge,
      balance_remaining: result.balance,
    };
  }

  /**
   * Pre-check cost before expensive operation
   */
  async estimateCost(usageType: string, value: number): Promise<number> {
    return await this.metering.calculateCost(usageType, value);
  }

  /**
   * Get combined usage + billing summary
   */
  async getSummary(
    userId: string,
    startTime: number,
    endTime: number
  ): Promise<{
    usage: any[];
    credits_spent: number;
    current_balance: number;
  }> {
    const [usage, transactions, balance] = await Promise.all([
      this.metering.getUsageSummary(userId, startTime, endTime),
      this.credits.getTransactions(userId, { after: startTime, before: endTime }),
      this.credits.getBalance(userId),
    ]);

    const creditsSpent = transactions
      .filter(tx => tx.amount < 0)
      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

    return {
      usage,
      credits_spent: creditsSpent,
      current_balance: balance,
    };
  }

  // Expose individual SDKs for direct access
  get meter() {
    return this.metering;
  }

  get wallet() {
    return this.credits;
  }
}
```

---

## Usage in Your Apps

### Initialize Pricing Rules (One-time Setup)

```typescript
// scripts/setup-pricing.ts
import { BillingSDK } from '@sparked/billing-sdk';

const billing = new BillingSDK({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
});

// Set pricing rules
await billing.meter.setPricingRule({
  type: 'llm.tokens',
  rate: 0.01, // 0.01 credits per token
  unit: 'token',
  description: 'Claude Sonnet 4 tokens',
});

await billing.meter.setPricingRule({
  type: 'llm.tokens.opus',
  rate: 0.05, // 5x more expensive
  unit: 'token',
  description: 'Claude Opus 4 tokens',
});

await billing.meter.setPricingRule({
  type: 'gpu.seconds',
  rate: 2, // 2 credits per second
  unit: 'second',
  description: 'GPU compute time',
});

await billing.meter.setPricingRule({
  type: 'video.generation',
  rate: 10, // 10 credits per second of video
  unit: 'second',
  description: 'Video generation',
  // Tiered pricing example
  tiered: [
    { from: 0, to: 60, rate: 10 },      // First 60s: 10 credits/sec
    { from: 60, to: 300, rate: 8 },     // 60-300s: 8 credits/sec
    { from: 300, to: Infinity, rate: 5 }, // 300+s: 5 credits/sec
  ],
});

await billing.meter.setPricingRule({
  type: 'training.gpu.hours',
  rate: 1000, // 1000 credits per GPU hour
  unit: 'hour',
  description: 'Model training compute',
});
```

### app.sparked.world - LLM Usage

```typescript
// app.sparked.world/app/api/chat/route.ts
import { billing } from '@/lib/billing';
import { auth } from '@clerk/nextjs';

export async function POST(req: Request) {
  const { userId } = auth();
  const { message, model } = await req.json();

  // Call Claude API
  const response = await anthropic.messages.create({
    model: model || 'claude-sonnet-4-20250514',
    messages: [{ role: 'user', content: message }],
  });

  // Get token usage
  const { input_tokens, output_tokens } = response.usage;
  const totalTokens = input_tokens + output_tokens;

  try {
    // Record usage + charge credits
    const result = await billing.recordAndCharge(
      userId,
      'app.sparked.world',
      model.includes('opus') ? 'llm.tokens.opus' : 'llm.tokens',
      totalTokens,
      'chat_message',
      {
        model,
        input_tokens,
        output_tokens,
        message_length: message.length,
        response_length: response.content[0].text.length,
      }
    );

    return Response.json({
      response: response.content[0].text,
      usage: {
        tokens: totalTokens,
        credits_charged: result.credits_charged,
        balance_remaining: result.balance_remaining,
      },
    });

  } catch (error) {
    if (error.name === 'InsufficientCreditsError') {
      // Estimate cost for user
      const estimatedCost = await billing.estimateCost('llm.tokens', totalTokens);
      
      return Response.json(
        {
          error: 'Insufficient credits',
          required: estimatedCost,
          available: error.available,
          message: `This message will cost ~${estimatedCost} credits. You have ${error.available} credits.`,
        },
        { status: 402 }
      );
    }
    throw error;
  }
}
```

### canvas.sparked.world - Image Generation

```typescript
// canvas.sparked.world/app/api/generate/route.ts
import { billing } from '@/lib/billing';

export async function POST(req: Request) {
  const { userId } = auth();
  const { prompt, size } = await req.json();

  // Start timer
  const startTime = Date.now();

  // Generate image
  const image = await generateImage(prompt, size);

  // Calculate GPU time
  const gpuSeconds = (Date.now() - startTime) / 1000;

  try {
    const result = await billing.recordAndCharge(
      userId,
      'canvas.sparked.world',
      'gpu.seconds',
      gpuSeconds,
      'image_generation',
      {
        prompt,
        size,
        model: 'stable-diffusion-xl',
      }
    );

    return Response.json({
      image,
      usage: {
        gpu_seconds: gpuSeconds,
        credits_charged: result.credits_charged,
        balance_remaining: result.balance_remaining,
      },
    });

  } catch (error) {
    // Handle error...
  }
}
```

### studio.sparked.world - Video Generation

```typescript
// studio.sparked.world/app/api/video/generate/route.ts
import { billing } from '@/lib/billing';

export async function POST(req: Request) {
  const { userId } = auth();
  const { prompt, duration, resolution } = await req.json();

  // Estimate cost BEFORE generating
  const estimatedCost = await billing.estimateCost('video.generation', duration);
  const balance = await billing.wallet.getBalance(userId);

  if (balance < estimatedCost) {
    return Response.json(
      {
        error: 'Insufficient credits',
        estimated_cost: estimatedCost,
        available: balance,
        message: `This video will cost ~${estimatedCost} credits. You have ${balance} credits.`,
      },
      { status: 402 }
    );
  }

  // Generate video
  const startTime = Date.now();
  const video = await generateVideo(prompt, duration, resolution);
  const gpuSeconds = (Date.now() - startTime) / 1000;

  try {
    // Charge based on video duration (not GPU time)
    const result = await billing.recordAndCharge(
      userId,
      'studio.sparked.world',
      'video.generation',
      duration,
      'video_generation',
      {
        prompt,
        duration,
        resolution,
        gpu_seconds: gpuSeconds,
        actual_vs_estimated: duration === estimatedCost ? 'exact' : 'different',
      }
    );

    return Response.json({
      video,
      usage: {
        duration,
        gpu_seconds: gpuSeconds,
        credits_charged: result.credits_charged,
        balance_remaining: result.balance_remaining,
      },
    });

  } catch (error) {
    // Handle error...
  }
}
```

### train.sparked.world - Model Training

```typescript
// train.sparked.world/app/api/train/start/route.ts
import { billing } from '@/lib/billing';

export async function POST(req: Request) {
  const { userId } = auth();
  const { modelType, epochs, datasetSize } = await req.json();

  // Estimate training time
  const estimatedHours = estimateTrainingTime(modelType, epochs, datasetSize);
  const estimatedCost = await billing.estimateCost('training.gpu.hours', estimatedHours);
  
  // Check balance
  const balance = await billing.wallet.getBalance(userId);

  if (balance < estimatedCost) {
    return Response.json(
      {
        error: 'Insufficient credits',
        estimated_cost: estimatedCost,
        estimated_hours: estimatedHours,
        available: balance,
        message: `This training job will cost ~${estimatedCost} credits (~${estimatedHours} GPU hours). You have ${balance} credits.`,
      },
      { status: 402 }
    );
  }

  // Start training job (async)
  const job = await startTrainingJob({
    userId,
    modelType,
    epochs,
    datasetSize,
  });

  // We'll charge AFTER completion via webhook
  return Response.json({
    job_id: job.id,
    status: 'started',
    estimated_cost: estimatedCost,
    message: 'Training started. You will be charged when it completes.',
  });
}

// Webhook handler when training completes
export async function handleTrainingComplete(jobId: string) {
  const job = await getTrainingJob(jobId);
  
  // Get actual GPU hours used
  const actualHours = job.metrics.gpu_hours;

  try {
    const result = await billing.recordAndCharge(
      job.userId,
      'train.sparked.world',
      'training.gpu.hours',
      actualHours,
      'model_training_completed',
      {
        job_id: jobId,
        model_type: job.modelType,
        epochs: job.completedEpochs,
        dataset_size: job.datasetSize,
        estimated_hours: job.estimatedHours,
        actual_hours: actualHours,
      }
    );

    // Notify user
    await notifyUser(job.userId, {
      message: `Training completed! Used ${actualHours} GPU hours (${result.credits_charged} credits). Remaining balance: ${result.balance_remaining} credits.`,
    });

  } catch (error) {
    if (error.name === 'InsufficientCreditsError') {
      // User ran out of credits during training!
      // Pause job or notify user
      await pauseTrainingJob(jobId);
      await notifyUser(job.userId, {
        message: 'Training paused: insufficient credits. Please add credits to continue.',
      });
    }
  }
}
```

---

## Analytics Dashboard API

```typescript
// apps/app/app/api/analytics/usage/route.ts
import { billing } from '@/lib/billing';
import { auth } from '@clerk/nextjs';

export async function GET(req: Request) {
  const { userId } = auth();
  const { searchParams } = new URL(req.url);
  
  const period = searchParams.get('period') || '30d';
  const endTime = Date.now();
  const startTime = endTime - (period === '30d' ? 30 : 7) * 24 * 60 * 60 * 1000;

  // Get comprehensive summary
  const summary = await billing.getSummary(userId, startTime, endTime);

  // Get daily breakdown for chart
  const dailyUsage = [];
  for (let i = 0; i < 30; i++) {
    const date = new Date(endTime - i * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
    
    const [tokens, gpuSeconds] = await Promise.all([
      billing.meter.getAggregatedUsage(userId, 'llm.tokens', 'daily', date),
      billing.meter.getAggregatedUsage(userId, 'gpu.seconds', 'daily', date),
    ]);

    dailyUsage.push({ date, tokens, gpuSeconds });
  }

  return Response.json({
    summary,
    daily_usage: dailyUsage.reverse(),
    period,
  });
}
```

---

## Benefits of This Approach

### ✅ **Separation of Concerns**

```
Metering Layer: "What did the user consume?"
├─ Tracks raw usage (tokens, GPU seconds, API calls)
├─ Immutable event log
└─ Aggregations for analytics

Credits Layer: "What did it cost?"
├─ Converts usage to credits via pricing rules
├─ Manages user balance
└─ Transaction history
```

### ✅ **Flexible Pricing**

```typescript
// Change pricing without touching code
await billing.meter.setPricingRule({
  type: 'llm.tokens',
  rate: 0.02, // Was 0.01, now 2x more expensive
  unit: 'token',
});

// All future charges use new rate
// Past charges are in transaction history with old rate
```

### ✅ **Transparency for Users**

```json
{
  "message": "Your request cost 47 credits",
  "breakdown": {
    "tokens_used": 4,742,
    "rate": "0.01 credits per token",
    "calculation": "4,742 × 0.01 = 47 credits"
  },
  "balance_remaining": 953
}
```

### ✅ **Analytics & Insights**

```typescript
// What's costing users the most?
const usage = await billing.meter.getUsageSummary(userId, startTime, endTime);

// Result:
// [
//   { type: 'training.gpu.hours', total: 12.5, cost: 12500, events: 3 },
//   { type: 'video.generation', total: 180, cost: 1800, events: 3 },
//   { type: 'llm.tokens', total: 45230, cost: 452, events: 127 },
//   { type: 'gpu.seconds', total: 382, cost: 764, events: 45 }
// ]

// Insight: Training is 80% of their costs!
```

### ✅ **Tiered Pricing Support**

```typescript
// Volume discounts automatically
await billing.meter.setPricingRule({
  type: 'llm.tokens',
  unit: 'token',
  tiered: [
    { from: 0, to: 100000, rate: 0.01 },        // First 100k: $0.01/token
    { from: 100000, to: 1000000, rate: 0.008 }, // Next 900k: $0.008/token
    { from: 1000000, to: Infinity, rate: 0.005 }, // Over 1M: $0.005/token
  ],
});

// Heavy users automatically get discounts
```

### ✅ **Audit Trail**

```typescript
// Every usage event is logged
const events = await billing.meter.getEvents(userId, startTime, endTime);

// [
//   { id: 'evt_abc', type: 'llm.tokens', value: 1542, app: 'app.sparked', ... },
//   { id: 'evt_def', type: 'gpu.seconds', value: 3.2, app: 'canvas.sparked', ... }
// ]

// Can prove exactly what user consumed
```

---

## Implementation Timeline

**Updated from original 5-7 days:**

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| 1. Metering SDK Core | 2 days | Event recording, aggregation, pricing engine |
| 2. Credits SDK Integration | 1 day | Combined billing SDK |
| 3. Pricing Rules Setup | 0.5 days | Configure rates for all usage types |
| 4. App Integration | 2 days | Integrate into all 4 apps with metering |
| 5. Analytics Dashboard | 1 day | Usage visualization |
| 6. Testing | 1 day | End-to-end testing |

**Total: 7.5 days**

(+1.5 days compared to credits-only approach, but you get proper metering)

---

## Cost Analysis

**Redis storage:**
```
Per user per month:
- Raw events: ~10KB * 1000 events = 10MB
- Aggregations: ~1KB * 60 days = 60KB
- Total: ~10MB per user per month

1000 users = 10GB/month

Upstash Redis: Free tier covers this
Paid tier: $10/mo for first 1GB, $2/GB after = ~$28/mo
```

**Worth it?** Yes, because you get:
- Exact cost tracking (save money on AI APIs)
- Usage analytics (understand user behavior)
- Flexible pricing (change rates without code deploys)
- Audit trail (compliance, debugging)

---

## Final Recommendation

**Yes, build your own metering system.**

**Why:**
- ✅ Your apps ARE fundamentally about metered AI usage
- ✅ Building it gives you full control over pricing
- ✅ It's only +1.5 days of development vs credits-only
- ✅ You avoid vendor lock-in (OpenMeter/Lago)
- ✅ You can evolve pricing as your business grows

**What you get:**
```
Layer 1: Metering (usage tracking)
Layer 2: Credits (billing abstraction)
Layer 3: User experience (transparent costs)
```


