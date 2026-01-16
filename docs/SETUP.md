# Credits SDK Setup Guide

Complete guide to integrate the Credits SDK into your Next.js applications.

## Prerequisites

- Upstash Redis instance ([create one here](https://console.upstash.com))
- Clerk authentication setup ([docs](https://clerk.com/docs))
- Next.js 13+ with App Router
- pnpm package manager

---

## Step 1: Install the SDK

In each of your 4 Next.js apps:

```bash
pnpm add @sparked/credits-sdk
```

Or if using a monorepo workspace, add to your workspace dependencies.

---

## Step 2: Set Environment Variables

Add to `.env.local` in each app:

```bash
# Upstash Redis
UPSTASH_REDIS_URL=https://your-redis.upstash.io
UPSTASH_REDIS_TOKEN=your_token_here

# Clerk
CLERK_WEBHOOK_SECRET=whsec_xxxxx
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxxxx
CLERK_SECRET_KEY=sk_test_xxxxx

# Optional: For cron jobs
CRON_SECRET=your_random_secret_here
```

Generate `CRON_SECRET`:
```bash
openssl rand -base64 32
```

---

## Step 3: Initialize Credits Client

Copy the template file to each app:

```bash
# From templates/lib/credits.ts to your app
cp templates/lib/credits.ts app/lib/credits.ts
```

Or create manually:

**File: `lib/credits.ts`**
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

## Step 4: Add API Routes

Copy the following routes to **ONE** of your apps (or all for redundancy):

### 4.1 Credits Balance

**File: `app/api/credits/balance/route.ts`**
```bash
cp templates/api/credits/balance/route.ts app/api/credits/balance/route.ts
```

### 4.2 Transaction History

**File: `app/api/credits/history/route.ts`**
```bash
cp templates/api/credits/history/route.ts app/api/credits/history/route.ts
```

### 4.3 Clerk Webhook (User Initialization)

**File: `app/api/webhooks/clerk/route.ts`**
```bash
cp templates/api/webhooks/clerk/route.ts app/api/webhooks/clerk/route.ts
```

**Important:** Configure webhook in Clerk Dashboard:
1. Go to [Clerk Dashboard](https://dashboard.clerk.com) → Webhooks
2. Add endpoint: `https://your-app.com/api/webhooks/clerk`
3. Subscribe to: `user.created`
4. Copy signing secret to `CLERK_WEBHOOK_SECRET`

### 4.4 Admin Grant Credits (Optional)

**File: `app/api/admin/credits/grant/route.ts`**
```bash
cp templates/api/admin/credits/grant/route.ts app/api/admin/credits/grant/route.ts
```

Update the `checkIsAdmin` function with your logic.

---

## Step 5: Integrate into App-Specific Routes

### app.sparked.world (Chat)

**File: `app/api/chat/route.ts`**
```bash
cp templates/app-specific/app.sparked.world/api/chat/route.ts app/api/chat/route.ts
```

Update the `processChatMessage` function with your implementation.

### canvas.sparked.world (Canvas Generation)

**File: `app/api/generate/route.ts`**
```bash
cp templates/app-specific/canvas.sparked.world/api/generate/route.ts app/api/generate/route.ts
```

Update the `generateCanvas` function with your implementation.

### studio.sparked.world (Video Generation)

**File: `app/api/video/generate/route.ts`**
```bash
cp templates/app-specific/studio.sparked.world/api/video/generate/route.ts app/api/video/generate/route.ts
```

Update the `generateVideo` function with your implementation.

### train.sparked.world (Model Training)

**Files:**
- `app/api/train/start/route.ts`
- `app/api/train/webhook/route.ts`

```bash
cp templates/app-specific/train.sparked.world/api/train/start/route.ts app/api/train/start/route.ts
cp templates/app-specific/train.sparked.world/api/train/webhook/route.ts app/api/train/webhook/route.ts
```

Update the placeholder functions with your implementations.

---

## Step 6: Add UI Components

Copy components to your app:

```bash
cp templates/components/credits-balance.tsx components/credits-balance.tsx
cp templates/components/transaction-history.tsx components/transaction-history.tsx
cp templates/components/insufficient-credits-dialog.tsx components/insufficient-credits-dialog.tsx
cp templates/components/credits-usage-chart.tsx components/credits-usage-chart.tsx
```

### Usage in Layout

```typescript
// app/layout.tsx
import { CreditsBalance } from '@/components/credits-balance';

export default function Layout({ children }) {
  return (
    <div>
      <header className="flex justify-between items-center p-4">
        <Logo />
        <CreditsBalance />
      </header>
      {children}
    </div>
  );
}
```

### Usage in Credits Page

```typescript
// app/credits/page.tsx
import { TransactionHistory } from '@/components/transaction-history';
import { CreditsUsageChart } from '@/components/credits-usage-chart';

export default function CreditsPage() {
  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-8">Credits</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <CreditsUsageChart days={7} />
        <TransactionHistory limit={20} />
      </div>
    </div>
  );
}
```

---

## Step 7: Set Up Reconciliation (Optional but Recommended)

### Option A: Vercel Cron

1. Copy `vercel.json`:
```bash
cp templates/vercel.json vercel.json
```

2. Copy cron route:
```bash
cp templates/api/cron/reconcile/route.ts app/api/cron/reconcile/route.ts
```

3. Update `getAllUserIds()` function with your user fetching logic

4. Deploy to Vercel - cron will run automatically every 6 hours

### Option B: Manual Script

1. Copy reconciliation script:
```bash
cp templates/scripts/reconcile-balances.ts scripts/reconcile-balances.ts
```

2. Update `getAllUserIds()` function

3. Run manually:
```bash
pnpm tsx scripts/reconcile-balances.ts
```

4. Or set up system cron:
```bash
0 */6 * * * cd /path/to/app && pnpm tsx scripts/reconcile-balances.ts
```

---

## Step 8: Test the Integration

### 8.1 Test User Initialization

1. Create a new user in Clerk
2. Check logs for webhook processing
3. Query balance:
```bash
curl https://your-app.com/api/credits/balance \
  -H "Authorization: Bearer YOUR_CLERK_TOKEN"
```

Expected: `{"balance": 100}`

### 8.2 Test Credit Deduction

```bash
# Chat message (10 credits)
curl -X POST https://app.sparked.world/api/chat \
  -H "Authorization: Bearer YOUR_CLERK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello"}'

# Check new balance
curl https://app.sparked.world/api/credits/balance \
  -H "Authorization: Bearer YOUR_CLERK_TOKEN"
```

Expected: `{"balance": 90}`

### 8.3 Test Shared Balance

```bash
# Use credits on app.sparked.world
curl -X POST https://app.sparked.world/api/chat ...

# Check balance on canvas.sparked.world
curl https://canvas.sparked.world/api/credits/balance ...
```

Both should show the same balance!

### 8.4 Test Insufficient Credits

Try an action that costs more than available balance:

```bash
# User has 40 credits, video costs 600 credits
curl -X POST https://studio.sparked.world/api/video/generate \
  -d '{"duration": 60}'
```

Expected: `402 Payment Required` with error details

---

## Step 9: Production Checklist

- [ ] Upstash Redis instance configured
- [ ] Environment variables set in all apps
- [ ] Clerk webhook configured and tested
- [ ] User initialization webhook working
- [ ] Credit deductions working in all apps
- [ ] Balance shared across apps verified
- [ ] Insufficient credits error handling tested
- [ ] UI components integrated
- [ ] Reconciliation job scheduled
- [ ] Admin endpoints secured
- [ ] Error monitoring configured
- [ ] Rate limiting added to API routes

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│  4 Next.js Apps (shared @sparked/credits-sdk)      │
│                                                     │
│  app.sparked.world    → Fixed:  10 credits/msg     │
│  canvas.sparked.world → Fixed:  50-75 credits/gen  │
│  studio.sparked.world → Metered: 10 credits/sec    │
│  train.sparked.world  → Metered: 1000 credits/hr   │
└───────────────────┬─────────────────────────────────┘
                    │
                    ▼
           ┌─────────────────┐
           │  Upstash Redis  │
           ├─────────────────┤
           │ balance:userId  │ ← O(1) reads, atomic writes
           │ txs:userId      │ ← Event sourcing log
           └─────────────────┘
```

---

## Pricing Configuration

### Fixed Costs
- Chat message: 10 credits
- Canvas (simple): 50 credits
- Canvas (complex): 75 credits

### Metered Costs
- Video: 10 credits/second
- Training: 1000 credits/GPU hour

### Adjusting Pricing

Edit `packages/credits-sdk/src/pricing.ts`:

```typescript
export const PRICING_CONFIG = {
  video_generation: {
    rate: 15, // Changed from 10 to 15
    unit: 'second',
    calculate: (seconds: number) => Math.ceil(seconds * 15)
  },
  // ...
};
```

Rebuild SDK:
```bash
cd packages/credits-sdk
pnpm build
```

---

## Troubleshooting

### Balance Not Syncing

Run reconciliation:
```bash
pnpm tsx scripts/reconcile-balances.ts
```

### Webhook Not Firing

1. Check Clerk webhook logs
2. Verify `CLERK_WEBHOOK_SECRET` is correct
3. Ensure endpoint is publicly accessible
4. Check server logs for errors

### Redis Connection Issues

1. Verify `UPSTASH_REDIS_URL` and `UPSTASH_REDIS_TOKEN`
2. Check Upstash dashboard for connection errors
3. Ensure Redis instance is in same region (lower latency)

### Race Condition Errors

This shouldn't happen (Lua scripts prevent it), but if it does:
1. Check Redis logs
2. Run reconciliation
3. Report issue with logs

---

## Support

For issues:
1. Check logs: `pnpm logs`
2. Run reconciliation: `pnpm tsx scripts/reconcile-balances.ts`
3. File issue with SDK version, error message, and steps to reproduce

---

## Next Steps

1. **Add Payment Integration**: Stripe, PayPal, etc. for purchasing credits
2. **Analytics Dashboard**: Track usage patterns, revenue, etc.
3. **Usage Limits**: Rate limiting per user/tier
4. **Subscription Plans**: Monthly credit allocation
5. **Credit Expiration**: Time-based credit expiry
6. **Referral Program**: Reward users for referrals with credits

Refer to `INTEGRATION.md` for detailed code examples.
