/**
 * @sparked/credits-sdk
 *
 * Shared credits system for Sparked applications with Redis-backed event sourcing
 */

// Main client
export { CreditsSDK } from './client';
// Errors
export {
  BalanceVerificationError,
  InsufficientCreditsError,
  PricingConfigError,
  TransactionError,
} from './errors';
// Pricing
export { FIXED_PRICING, PRICING_CONFIG, PricingEngine } from './pricing';
// Types
export type {
  BalanceVerification,
  CreditsConfig,
  PricingConfig,
  Transaction,
  TransactionQueryOptions,
  TransactionResult,
} from './types';
