# CLAUDE.md — @sparked/credits-sdk

Credits management SDK. Redis-backed event sourcing with atomic Lua scripts. Used by app, canvas, subscribe.

## Commands

`pnpm build` | `pnpm test` (needs UPSTASH_REDIS_URL + TOKEN) | `pnpm check` (biome)

## Architecture

- **Redis keys**: `balance:{userId}` (cached balance, O(1) read) + `txs:{userId}` (sorted set, source of truth). Never change these patterns.
- **Atomicity**: All mutations use inline Lua scripts in `src/client.ts`. Never split into separate Redis calls — that breaks the race condition protection.
- **Self-healing**: `verifyBalance()` recalculates from tx log. `rebuildBalance()` fixes cache drift.
- **Pricing**: Fixed pricing in `src/pricing.ts` (chat: 10, canvas: 50-75 credits). Metered pricing for video/training.
- **Errors**: `InsufficientCreditsError` → HTTP 402. Don't throw generic `Error`.

## Gotchas

- Tests skip automatically without Redis credentials.
- `dist/` is committed (not gitignored) — consumers install via `github:sparked-world/credits-sdk`.
- `templates/` are copy-paste starting points, not part of the build. Lint warnings there are intentional.
- Breaking changes affect app, canvas, and subscribe.
