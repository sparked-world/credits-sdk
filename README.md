# @sparked/credits-sdk

Shared credits system for Sparked applications with Redis-backed event sourcing and atomic operations.

## Features

- **Shared Balance**: Single source of truth for user credits across all Sparked apps
- **Atomic Operations**: Lua scripts prevent race conditions during concurrent deductions
- **Event Sourcing**: Immutable transaction log for audit trail and reconciliation
- **Selective Metering**: Fixed costs for chat/canvas, dynamic pricing for video/training
- **Self-Healing**: Balance verification and reconciliation tools
- **Type-Safe**: Full TypeScript support with comprehensive type definitions

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  All 4 Apps (shared @sparked/credits-sdk package)  │
└───────────────────┬─────────────────────────────────┘
                    │
                    ▼
           ┌─────────────────┐
           │  Upstash Redis  │
           ├─────────────────┤
           │ balance:userId  │ ← Cached balance (O(1) reads)
           │ txs:userId      │ ← Transaction log (audit + reconciliation)
           └─────────────────┘
```

## Installation

```bash
npm install @sparked/credits-sdk
# or
yarn add @sparked/credits-sdk
# or
pnpm add @sparked/credits-sdk
```

## Quick Start

### 1. Setup Upstash Redis

Create a Redis instance at [upstash.com](https://upstash.com) and get your REST URL and token.

### 2. Initialize the SDK

```typescript
import { CreditsSDK } from '@sparked/credits-sdk';

export const credits = new CreditsSDK({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
  options: {
    defaultCredits: 100, // Free tier credits
  },
});
```

### 3. Initialize New Users

```typescript
// In your Clerk webhook handler
await credits.initializeUser(userId, 100);
```

### 4. Deduct Credits

```typescript
try {
  const result = await credits.deduct(userId, 10, 'chat_message', {
    app: 'app.sparked.world',
    model: 'claude-sonnet-4',
  });

  console.log(`Credits remaining: ${result.balance}`);
} catch (error) {
  if (error.name === 'InsufficientCreditsError') {
    // Handle insufficient credits
    console.error(`Need ${error.required}, have ${error.available}`);
  }
}
```

## API Reference

### CreditsSDK

Main client for managing user credits.

#### Constructor

```typescript
new CreditsSDK(config: CreditsConfig)
```

**Parameters:**
- `config.url`: Upstash Redis REST URL
- `config.token`: Upstash Redis REST token
- `config.options.defaultCredits`: Default credits for new users (default: 100)

#### Methods

##### `initializeUser(userId, credits?)`

Initialize a new user with credits.

```typescript
const result = await credits.initializeUser('user_123', 100);
// Returns: { txId, balance, timestamp }
```

##### `deduct(userId, amount, action, metadata?)`

Atomically deduct credits from a user's balance.

```typescript
const result = await credits.deduct(
  'user_123',
  10,
  'chat_message',
  { app: 'app.sparked.world' }
);
// Returns: { txId, balance, timestamp }
// Throws: InsufficientCreditsError if balance too low
```

##### `add(userId, amount, action, metadata?)`

Add credits to a user's balance.

```typescript
const result = await credits.add(
  'user_123',
  100,
  'purchase',
  { payment_id: 'pay_123' }
);
// Returns: { txId, balance, timestamp }
```

##### `getBalance(userId)`

Get a user's current balance (O(1) operation).

```typescript
const balance = await credits.getBalance('user_123');
// Returns: number
```

##### `getTransactions(userId, options?)`

Retrieve transaction history for a user.

**Parameters:**
- `userId` (string): User ID
- `options` (object, optional):
  - `limit` (number): Max transactions to return (default: 50, max: 1000)
  - `startTime` (number): Unix timestamp in ms - filter transactions after this time
  - `endTime` (number): Unix timestamp in ms - filter transactions before this time

**Behavior:**
- **No time range** (default): Returns latest N transactions by index (most efficient)
- **With time range**: Filters transactions within the specified time window

**Performance Notes:**
- Index queries (no time filter): O(log N + M) where M = limit
- Score queries (with time filter): O(log N + K) where K = transactions in range, then sliced to limit
- For large time ranges, use narrow windows or increase limit cautiously

**Examples:**
```typescript
// Get latest 50 transactions (default)
const recent = await credits.getTransactions('user_123');

// Get last 100 transactions
const last100 = await credits.getTransactions('user_123', { limit: 100 });

// Get transactions from last hour
const hourAgo = Date.now() - 60 * 60 * 1000;
const recentHour = await credits.getTransactions('user_123', {
  startTime: hourAgo,
  endTime: Date.now()
});
// Returns: Transaction[]
```

##### `verifyBalance(userId)`

Verify that cached balance matches transaction log.

```typescript
const verification = await credits.verifyBalance('user_123');
// Returns: { valid, cached, calculated, difference }
```

##### `rebuildBalance(userId)`

Rebuild balance from transaction log (fixes inconsistencies).

```typescript
const correctedBalance = await credits.rebuildBalance('user_123');
// Returns: number
```

### PricingEngine

Calculate costs for metered operations.

```typescript
import { PricingEngine } from '@sparked/credits-sdk';

const pricing = new PricingEngine();

// Calculate video generation cost
const cost = pricing.calculateCost('video_generation', 30); // 30 seconds
// Returns: 300 (30 seconds * 10 credits/second)

// Calculate training job cost
const cost = pricing.calculateCost('training_job', 2); // 2 GPU hours
// Returns: 2000 (2 hours * 1000 credits/hour)
```

## Usage Examples

### Fixed Cost: Chat Messages

```typescript
// app.sparked.world/api/chat/route.ts
import { credits } from '@/lib/credits';
import { FIXED_PRICING } from '@sparked/credits-sdk';

export async function POST(req: Request) {
  const { userId } = auth();

  try {
    await credits.deduct(
      userId,
      FIXED_PRICING.chat_message, // 10 credits
      'chat_message',
      { app: 'app.sparked.world' }
    );

    const response = await processChatMessage(req);
    return Response.json(response);
  } catch (error) {
    if (error.name === 'InsufficientCreditsError') {
      return Response.json(
        { error: 'Insufficient credits', required: error.required },
        { status: 402 }
      );
    }
    throw error;
  }
}
```

### Fixed Cost: Canvas Generation

```typescript
// canvas.sparked.world/api/generate/route.ts
import { credits } from '@/lib/credits';
import { FIXED_PRICING } from '@sparked/credits-sdk';

export async function POST(req: Request) {
  const { userId } = auth();
  const { complexity } = await req.json();

  const cost = complexity === 'high'
    ? FIXED_PRICING.canvas_generation_complex // 75 credits
    : FIXED_PRICING.canvas_generation_simple; // 50 credits

  await credits.deduct(userId, cost, 'canvas_generation', { complexity });

  const canvas = await generateCanvas(req);
  return Response.json({ canvas });
}
```

### Metered Cost: Video Generation

```typescript
// studio.sparked.world/api/video/generate/route.ts
import { credits } from '@/lib/credits';
import { PricingEngine } from '@sparked/credits-sdk';

const pricing = new PricingEngine();

export async function POST(req: Request) {
  const { userId } = auth();
  const { duration } = await req.json();

  // Calculate cost based on video duration
  const cost = pricing.calculateCost('video_generation', duration);

  // Pre-check balance
  const balance = await credits.getBalance(userId);
  if (balance < cost) {
    return Response.json(
      { error: 'Insufficient credits', estimated_cost: cost },
      { status: 402 }
    );
  }

  await credits.deduct(userId, cost, 'video_generation', {
    duration,
    credits_per_second: 10,
  });

  const video = await generateVideo({ duration });
  return Response.json({ video });
}
```

### Metered Cost: Training (Post-Charge)

```typescript
// train.sparked.world/api/train/start/route.ts
import { credits } from '@/lib/credits';
import { PricingEngine } from '@sparked/credits-sdk';

const pricing = new PricingEngine();

export async function POST(req: Request) {
  const { userId } = auth();
  const { modelType, epochs } = await req.json();

  // Estimate cost
  const estimatedHours = estimateTrainingTime(modelType, epochs);
  const estimatedCost = pricing.calculateCost('training_job', estimatedHours);

  // Check balance before starting
  const balance = await credits.getBalance(userId);
  if (balance < estimatedCost) {
    return Response.json(
      { error: 'Insufficient credits', estimated_cost: estimatedCost },
      { status: 402 }
    );
  }

  const job = await startTrainingJob({ userId, modelType, epochs });

  return Response.json({ job_id: job.id, estimated_cost: estimatedCost });
}

// Webhook handler for completion
export async function handleTrainingComplete(jobId: string) {
  const job = await getTrainingJob(jobId);
  const actualCost = pricing.calculateCost('training_job', job.metrics.gpu_hours);

  await credits.deduct(job.userId, actualCost, 'training_completed', {
    job_id: jobId,
    gpu_hours: job.metrics.gpu_hours,
  });
}
```

### Clerk Webhook Integration

```typescript
// app/api/webhooks/clerk/route.ts
import { Webhook } from 'svix';
import { credits } from '@/lib/credits';

export async function POST(req: Request) {
  const payload = await req.json();

  // Verify webhook (see Clerk docs)
  const evt = verifyWebhook(payload);

  if (evt.type === 'user.created') {
    const { id } = evt.data;
    await credits.initializeUser(id, 100);
    console.log(`Initialized credits for user ${id}`);
  }

  return new Response('OK', { status: 200 });
}
```

### Admin Grant Credits

```typescript
// app/api/admin/credits/grant/route.ts
import { credits } from '@/lib/credits';

export async function POST(req: Request) {
  const { userId } = auth();
  const isAdmin = await checkIsAdmin(userId);

  if (!isAdmin) {
    return Response.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { targetUserId, amount, reason } = await req.json();

  const result = await credits.add(targetUserId, amount, reason, {
    granted_by: userId,
    admin_action: true,
  });

  return Response.json(result);
}
```

### Balance Reconciliation

```typescript
// scripts/reconcile-balances.ts
import { CreditsSDK } from '@sparked/credits-sdk';

const credits = new CreditsSDK({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
});

async function reconcileAll() {
  const userIds = await getAllUserIds();

  for (const userId of userIds) {
    const verification = await credits.verifyBalance(userId);

    if (!verification.valid) {
      console.log(`Fixing ${userId}: ${verification.cached} → ${verification.calculated}`);
      await credits.rebuildBalance(userId);
    }
  }
}

reconcileAll();
```

## Pricing Configuration

### Fixed Costs

```typescript
import { FIXED_PRICING } from '@sparked/credits-sdk';

FIXED_PRICING.chat_message // 10 credits
FIXED_PRICING.canvas_generation_simple // 50 credits
FIXED_PRICING.canvas_generation_complex // 75 credits
```

### Metered Costs

```typescript
import { PRICING_CONFIG } from '@sparked/credits-sdk';

PRICING_CONFIG.video_generation // 10 credits/second
PRICING_CONFIG.training_job // 1000 credits/GPU hour
```

### Custom Pricing

```typescript
import { PricingEngine } from '@sparked/credits-sdk';

const customPricing = new PricingEngine({
  custom_action: {
    rate: 15,
    unit: 'item',
    calculate: (value: number) => Math.ceil(value * 15),
  },
});

const cost = customPricing.calculateCost('custom_action', 10);
```

## Error Handling

The SDK provides custom error types for different failure scenarios:

```typescript
import {
  InsufficientCreditsError,
  TransactionError,
  BalanceVerificationError,
  PricingConfigError,
} from '@sparked/credits-sdk';

try {
  await credits.deduct(userId, 100, 'action');
} catch (error) {
  if (error instanceof InsufficientCreditsError) {
    console.error(`Need ${error.required}, have ${error.available}`);
  } else if (error instanceof TransactionError) {
    console.error(`Transaction failed: ${error.message}`);
  }
}
```

## Testing

```bash
# Run tests (requires Upstash Redis credentials)
export UPSTASH_REDIS_URL="https://your-redis.upstash.io"
export UPSTASH_REDIS_TOKEN="your_token"

npm test

# Watch mode
npm run test:watch
```

## Development

```bash
# Install dependencies
npm install

# Type check
npm run typecheck

# Build
npm run build

# Watch mode
npm run dev
```

## Environment Variables

```bash
UPSTASH_REDIS_URL=https://your-redis.upstash.io
UPSTASH_REDIS_TOKEN=your_token_here
```

## Cost Estimate

**Upstash Redis:**
- Free tier: 10,000 commands/day
- Paid tier: $10/mo for 100,000 commands/day
- Additional: $0.20 per 100,000 commands

For 1,000 users with 25 operations/day:
- **Total: ~$12-15/month**

## Best Practices

1. **Pre-check Balance**: For expensive operations, check balance before starting
2. **Handle Errors**: Always catch `InsufficientCreditsError` and return 402 status
3. **Include Metadata**: Add context to transactions for debugging and analytics
4. **Run Reconciliation**: Schedule hourly/daily reconciliation jobs
5. **Monitor Transactions**: Track transaction patterns to detect anomalies

## License

MIT

## Support

For issues and questions, please file an issue on GitHub.
