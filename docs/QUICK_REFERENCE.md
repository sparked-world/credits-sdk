# Credits SDK - Quick Reference

Fast reference for common operations.

---

## 🚀 Installation

```bash
pnpm add @sparked/credits-sdk
```

---

## ⚙️ Setup

```typescript
// lib/credits.ts
import { CreditsSDK } from '@sparked/credits-sdk';

export const credits = new CreditsSDK({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
  options: { defaultCredits: 100 },
});
```

---

## 📝 Common Operations

### Initialize User
```typescript
const result = await credits.initializeUser(userId, 100);
// { txId, balance: 100, timestamp }
```

### Deduct Credits (Fixed)
```typescript
import { FIXED_PRICING } from '@sparked/credits-sdk';

await credits.deduct(
  userId,
  FIXED_PRICING.chat_message, // 10
  'chat_message',
  { app: 'app.sparked.world' }
);
```

### Deduct Credits (Metered)
```typescript
import { PricingEngine } from '@sparked/credits-sdk';

const pricing = new PricingEngine();
const cost = pricing.calculateCost('video_generation', 30); // 300

await credits.deduct(userId, cost, 'video_generation', {
  duration: 30,
  credits_per_second: 10,
});
```

### Add Credits
```typescript
await credits.add(userId, 1000, 'purchase', {
  payment_id: 'pay_123',
});
```

### Get Balance
```typescript
const balance = await credits.getBalance(userId);
```

### Get History
```typescript
const txs = await credits.getTransactions(userId, {
  limit: 50,
  startTime: Date.now() - 86400000, // Last 24h
});
```

### Verify Balance
```typescript
const { valid, cached, calculated } = await credits.verifyBalance(userId);

if (!valid) {
  await credits.rebuildBalance(userId);
}
```

---

## 🎨 Pricing

### Fixed
```typescript
FIXED_PRICING.chat_message              // 10
FIXED_PRICING.canvas_generation_simple  // 50
FIXED_PRICING.canvas_generation_complex // 75
```

### Metered
```typescript
pricing.calculateCost('video_generation', 30)  // 30s × 10 = 300
pricing.calculateCost('training_job', 2)       // 2h × 1000 = 2000
```

---

## ⚠️ Error Handling

```typescript
import { InsufficientCreditsError } from '@sparked/credits-sdk';

try {
  await credits.deduct(userId, 100, 'action');
} catch (error) {
  if (error instanceof InsufficientCreditsError) {
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
```

---

## 🧩 API Routes

### Get Balance
```typescript
// GET /api/credits/balance
export async function GET() {
  const { userId } = await auth();
  const balance = await credits.getBalance(userId);
  return Response.json({ balance });
}
```

### Deduct (Chat Example)
```typescript
// POST /api/chat
export async function POST(req) {
  const { userId } = await auth();

  await credits.deduct(
    userId,
    FIXED_PRICING.chat_message,
    'chat_message'
  );

  const response = await processChat(req);
  return Response.json(response);
}
```

### Deduct (Video Example)
```typescript
// POST /api/video/generate
export async function POST(req) {
  const { userId } = await auth();
  const { duration } = await req.json();

  const pricing = new PricingEngine();
  const cost = pricing.calculateCost('video_generation', duration);

  // Pre-check
  const balance = await credits.getBalance(userId);
  if (balance < cost) {
    return Response.json({ error: 'Insufficient credits' }, { status: 402 });
  }

  await credits.deduct(userId, cost, 'video_generation', { duration });

  const video = await generateVideo(duration);
  return Response.json({ video });
}
```

---

## 🎯 UI Components

### Balance Widget
```typescript
import { CreditsBalance } from '@/components/credits-balance';

<CreditsBalance refreshInterval={30000} />
```

### Transaction History
```typescript
import { TransactionHistory } from '@/components/transaction-history';

<TransactionHistory limit={20} />
```

### Insufficient Credits Dialog
```typescript
import { InsufficientCreditsDialog } from '@/components/insufficient-credits-dialog';

const [open, setOpen] = useState(false);

<InsufficientCreditsDialog
  open={open}
  onOpenChange={setOpen}
  required={100}
  available={50}
/>
```

---

## 🔄 Reconciliation

### Manual Script
```bash
pnpm tsx scripts/reconcile-balances.ts
```

### Cron Endpoint
```typescript
// GET /api/cron/reconcile
// Authorization: Bearer YOUR_CRON_SECRET

// Add to vercel.json:
{
  "crons": [{
    "path": "/api/cron/reconcile",
    "schedule": "0 */6 * * *"
  }]
}
```

---

## 🔑 Environment Variables

```bash
UPSTASH_REDIS_URL=https://your-redis.upstash.io
UPSTASH_REDIS_TOKEN=your_token_here
CLERK_WEBHOOK_SECRET=whsec_xxxxx
CRON_SECRET=your_cron_secret
```

---

## 📊 Redis Data Structure

```
balance:user_123        → "950"           (cached balance)
txs:user_123            → Sorted set      (transaction log)
  score: 1705430400000  → {id, amount, action, metadata, timestamp}
  score: 1705430500000  → {id, amount, action, metadata, timestamp}
  ...
```

---

## 🐛 Debugging

### Check Balance
```bash
redis-cli -u $UPSTASH_REDIS_URL GET balance:user_123
```

### Check Transactions
```bash
redis-cli -u $UPSTASH_REDIS_URL ZRANGE txs:user_123 0 -1 WITHSCORES
```

### Verify Balance
```typescript
const verification = await credits.verifyBalance('user_123');
console.log(verification);
// { valid: true, cached: 100, calculated: 100, difference: 0 }
```

---

## 📚 Documentation

- `README.md` - Full API reference
- `SETUP.md` - Setup guide
- `INTEGRATION.md` - Integration examples
- `IMPLEMENTATION_SUMMARY.md` - Architecture overview

---

## 💡 Pro Tips

1. **Always pre-check balance** for expensive operations
2. **Use metadata** for debugging and analytics
3. **Run reconciliation** regularly (6-hour cron recommended)
4. **Monitor 402 errors** to optimize pricing
5. **Test concurrent operations** in staging
6. **Cache balance on client** (refresh every 30s)
7. **Add retry logic** for transient Redis errors

---

## 🆘 Common Issues

### Balance not syncing
```bash
pnpm tsx scripts/reconcile-balances.ts
```

### Webhook not firing
Check Clerk Dashboard → Webhooks → Logs

### Redis connection error
Verify `UPSTASH_REDIS_URL` and `UPSTASH_REDIS_TOKEN`

### Type errors
```bash
pnpm add @sparked/credits-sdk@latest
```

---

## 📞 Support

- Check logs for errors
- Run reconciliation script
- Consult full docs: `README.md`, `SETUP.md`, `INTEGRATION.md`
