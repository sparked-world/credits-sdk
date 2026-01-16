# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is `@sparked/credits-sdk` - a production-ready credits management system designed for 4 Sparked Next.js applications (app, canvas, studio, train). The SDK provides shared credit balances across multiple apps using Redis-backed event sourcing with atomic operations.

**Key Architecture Decision**: Uses Upstash Redis with Lua scripts for atomic credit deductions to prevent race conditions when multiple apps access the same user's balance simultaneously.

## Development Commands

### Package Manager
This project uses **pnpm** exclusively. Always use `pnpm` instead of npm or yarn.

### Build & Development
```bash
pnpm install          # Install dependencies
pnpm build            # Build package (CJS, ESM, and .d.ts files to dist/)
pnpm dev              # Build in watch mode
pnpm typecheck        # Run TypeScript type checking without emitting files
```

### Testing
```bash
pnpm test             # Run all tests (requires Upstash Redis credentials)
pnpm test:watch       # Run tests in watch mode

# Environment variables required for tests:
export UPSTASH_REDIS_URL="https://your-redis.upstash.io"
export UPSTASH_REDIS_TOKEN="your_token"
```

**Note**: Tests are skipped automatically if Redis credentials are not provided. The test suite includes race condition tests that verify Lua script atomicity.

### Linting & Formatting
```bash
pnpm lint             # Run Biome linter
pnpm lint:fix         # Fix linting issues
pnpm format           # Check code formatting
pnpm format:fix       # Apply code formatting
pnpm check            # Run both linting and formatting checks
pnpm check:fix        # Fix all auto-fixable issues
```

**Biome Configuration**: The project uses Biome (v2.3.11) for fast linting and formatting. Configuration is in `biome.json`. Biome respects `.gitignore` and automatically ignores `dist/`, `node_modules/`, etc.

**Template files**: Some linting warnings in `templates/` are intentional (e.g., unused parameters in placeholder functions marked with TODO). These are meant to be customized by SDK consumers.

## Core Architecture

### Data Model (Redis)

The SDK uses two Redis data structures per user:

1. **`balance:userId`** (String) - Cached balance for O(1) reads
2. **`txs:userId`** (Sorted Set) - Transaction log, scored by timestamp

**Critical**: These two structures must always be updated atomically together, which is why Lua scripts are used.

### Atomic Operations Pattern

All credit mutations use embedded Lua scripts executed via `redis.eval()`. The pattern:

```lua
-- Get current balance
local balance = redis.call('GET', balance_key)

-- Validate operation
if balance < amount then
  return redis.error_reply('INSUFFICIENT_CREDITS:' .. balance)
end

-- Update both balance AND transaction log atomically
redis.call('SET', balance_key, new_balance)
redis.call('ZADD', txs_key, timestamp, tx_data)
```

**Why this matters**: Without Lua scripts, two apps could check balance simultaneously, both see sufficient credits, and both deduct - causing overdraft. The Lua script ensures this runs as a single atomic operation on Redis.

### Event Sourcing & Reconciliation

The transaction log (`txs:userId`) is the source of truth. The cached balance is a performance optimization. The SDK provides:

- `verifyBalance()` - Recalculates balance from transaction log and compares to cached value
- `rebuildBalance()` - Fixes cache from transaction log if inconsistency detected

This "self-healing" architecture ensures data integrity even if cache corruption occurs.

### Pricing Models

**Two distinct pricing models** are supported:

1. **Fixed Pricing** (`FIXED_PRICING` in `src/pricing.ts`)
   - Used for: chat messages (10 credits), canvas generation (50-75 credits)
   - Simple, predictable costs
   - Deduction happens immediately before processing

2. **Metered Pricing** (`PRICING_CONFIG` in `src/pricing.ts`)
   - Used for: video generation (10 credits/sec), training jobs (1000 credits/GPU hour)
   - Dynamic cost based on actual usage
   - For training: Pre-check balance before starting, charge actual cost on completion (webhook pattern)

## File Structure

### Core SDK (`src/`)
- `client.ts` - Main `CreditsSDK` class (347 lines)
  - Contains all Lua scripts inline
  - All public methods are async (Redis operations)
  - Key generator methods: `getBalanceKey()`, `getTransactionsKey()`, `generateTxId()`
- `types.ts` - TypeScript interfaces (no runtime code)
- `errors.ts` - Custom error classes extending `Error`
- `pricing.ts` - `PricingEngine` class and pricing constants
- `index.ts` - Public API exports

### Tests (`tests/`)
- `client.test.ts` - SDK operations, race conditions, reconciliation
- `pricing.test.ts` - Pricing calculations and validation

**Important**: Tests use `describe.skipIf()` to skip if Redis credentials missing. When adding tests, follow this pattern.

### Templates (`templates/`)
Integration templates for Next.js apps. These are **NOT** part of the SDK package - they're copy-paste starting points for consumers.

**Directory structure**:
- `lib/` - SDK initialization wrapper
- `api/` - Shared API routes (balance, history, webhooks, admin, cron)
- `app-specific/` - Per-app routes (chat, canvas, video, training)
- `components/` - React UI components (balance widget, transaction list, etc.)
- `scripts/` - Utility scripts (reconciliation)

### Documentation
- `README.md` - Public-facing API documentation
- `SETUP.md` - Step-by-step integration guide
- `INTEGRATION.md` - Detailed code examples for Next.js
- `QUICK_REFERENCE.md` - Cheat sheet for common operations
- `IMPLEMENTATION_SUMMARY.md` - Architecture deep-dive

## Important Implementation Details

### Transaction IDs
Format: `tx_{timestamp}_{random}` generated by `generateTxId()`. Ensures uniqueness across distributed systems.

### Redis Key Patterns
- Balance: `balance:{userId}`
- Transactions: `txs:{userId}`

**Do not change these patterns** - they're part of the stable API and changing them would break existing deployments.

### Error Handling

Custom errors for different failure modes:
- `InsufficientCreditsError` - Should return HTTP 402 (Payment Required)
- `TransactionError` - Generic transaction failures
- `BalanceVerificationError` - Reconciliation issues
- `PricingConfigError` - Invalid pricing configuration

When adding new operations, throw appropriate error types, not generic `Error`.

### Package Exports

The package uses modern `exports` in `package.json`:
```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.mjs",
    "require": "./dist/index.js"
  }
}
```

**Order matters**: `types` must come before `import`/`require` for proper TypeScript resolution.

## Testing Strategy

### What to Test
- **Atomic operations**: Race condition scenarios (see `concurrent deductions` test)
- **Balance reconciliation**: Verify calculated vs cached balance
- **Error conditions**: Insufficient credits, negative amounts, invalid inputs
- **Edge cases**: Zero credits, first transaction, user re-initialization

### What NOT to Test
- Redis connection failures (infra concern, not SDK logic)
- Network timeouts (covered by Upstash SDK)

### Running Individual Tests
```bash
# Run specific test file
pnpm test tests/client.test.ts

# Run specific test by name
pnpm test -t "should deduct credits successfully"

# Run with coverage
pnpm test --coverage
```

## Common Modifications

### Adding New Pricing Tiers
1. Add to `PRICING_CONFIG` or `FIXED_PRICING` in `src/pricing.ts`
2. Export if needed from `src/index.ts`
3. Add tests in `tests/pricing.test.ts`
4. Update documentation in `README.md`

### Adding New SDK Methods
1. Add to `CreditsSDK` class in `src/client.ts`
2. Add TypeScript types in `src/types.ts` if needed
3. Export from `src/index.ts`
4. Add tests in `tests/client.test.ts`
5. Update `README.md` API reference
6. Consider adding example in `examples/basic-usage.ts`

### Modifying Lua Scripts
**Exercise extreme caution**. Lua scripts are the core atomicity guarantee.

Steps:
1. Modify script in `src/client.ts` (inline string)
2. Add comprehensive tests covering edge cases
3. Test race conditions specifically
4. Run manual Redis tests if possible
5. Document changes in code comments

**Never**: Remove the atomicity guarantee by splitting Lua operations into separate Redis calls.

### Modifying Biome Configuration
To adjust linting or formatting rules, edit `biome.json`:

```json
{
  "linter": {
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "off"  // Example: disable specific rule
      }
    }
  }
}
```

After changing configuration:
1. Run `pnpm check` to verify changes
2. Run `pnpm check:fix` to apply to existing code
3. Rebuild with `pnpm build` to ensure no build errors

## Integration with Next.js Apps

The SDK is designed to be integrated into 4 Next.js apps:
- **app.sparked.world** - Chat (fixed pricing)
- **canvas.sparked.world** - Canvas generation (fixed pricing)
- **studio.sparked.world** - Video generation (metered pricing, pre-charge)
- **train.sparked.world** - Model training (metered pricing, post-charge via webhook)

When working on templates:
- Always use `await auth()` from `@clerk/nextjs/server` for authentication
- Return `NextResponse.json()` with appropriate HTTP status codes
- Use 402 (Payment Required) for insufficient credits
- Include metadata in all transactions for debugging/analytics
- Pre-check balance for expensive operations before starting work

## Build Output

After running `pnpm build`, the `dist/` folder contains:
- `index.js` - CommonJS bundle
- `index.mjs` - ES Module bundle
- `index.d.ts` - TypeScript definitions (CommonJS)
- `index.d.mts` - TypeScript definitions (ESM)

All exports go through `src/index.ts` - this is the public API surface.

## Dependencies

**Runtime**:
- `@upstash/redis` - Redis client with REST API support

**Development**:
- `tsup` - Zero-config TypeScript bundler (chosen for speed and simplicity)
- `vitest` - Test runner (chosen for native ESM and TypeScript support)
- `typescript` - Type checking

**No peer dependencies** - SDK is self-contained.

## Redis Schema Evolution

If you need to change the Redis data structure:

1. **Add new keys**, don't modify existing ones (for backward compatibility)
2. Provide migration path in reconciliation script
3. Update both `verifyBalance()` and `calculateBalanceFromTransactions()`
4. Version the change in `package.json`
5. Document migration steps in release notes

## Performance Considerations

- Balance reads are O(1) - use `getBalance()` freely
- Transaction queries are O(log N + M) where N=total transactions, M=limit
- Reconciliation is O(N) - run periodically, not per-request
- Lua script execution is ~1-5ms on Upstash (sub-10ms p99)

**For high-traffic apps**: Consider caching balance on client-side for 30-60 seconds to reduce Redis calls.

## Troubleshooting

### Tests failing with Redis errors
Ensure environment variables are set:
```bash
export UPSTASH_REDIS_URL="https://your-redis.upstash.io"
export UPSTASH_REDIS_TOKEN="your_token"
```

### Build warnings about export conditions
The package.json `exports` field must have `types` first. This is correct and intentional.

### TypeScript errors in templates
Templates are not part of the build - they're copy-paste starting points. Type errors in templates won't affect SDK build.

### Balance inconsistencies
Run reconciliation:
```bash
pnpm tsx scripts/reconcile-balances.ts
```
Or programmatically: `await credits.rebuildBalance(userId)`
