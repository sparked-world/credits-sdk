/**
 * Configuration options for the Credits SDK
 */
export interface CreditsConfig {
  /** Upstash Redis REST URL */
  url: string;
  /** Upstash Redis REST token */
  token: string;
  /** Optional configuration */
  options?: {
    /** Default credits for new users */
    defaultCredits?: number;
  };
}

/**
 * Represents a single credit transaction
 */
export interface Transaction {
  /** Unique transaction ID */
  id: string;
  /** Amount of credits (positive for additions, negative for deductions) */
  amount: number;
  /** Action type (e.g., 'chat_message', 'video_generation') */
  action: string;
  /** Additional metadata about the transaction */
  metadata?: Record<string, any>;
  /** Unix timestamp in milliseconds */
  timestamp: number;
}

/**
 * Result of a successful transaction
 */
export interface TransactionResult {
  /** Unique transaction ID */
  txId: string;
  /** New balance after transaction */
  balance: number;
  /** Transaction timestamp */
  timestamp: number;
}

/**
 * Options for querying transactions
 */
export interface TransactionQueryOptions {
  /** Maximum number of transactions to return */
  limit?: number;
  /** Start timestamp (inclusive) */
  startTime?: number;
  /** End timestamp (inclusive) */
  endTime?: number;
}

/**
 * Result of balance verification/reconciliation
 */
export interface BalanceVerification {
  /** Whether the cached balance matches calculated balance */
  valid: boolean;
  /** Cached balance from Redis */
  cached: number;
  /** Calculated balance from transaction log */
  calculated: number;
  /** Difference between cached and calculated (cached - calculated) */
  difference: number;
}

/**
 * Pricing configuration for a metered action
 */
export interface PricingConfig {
  /** Cost per unit */
  rate: number;
  /** Unit of measurement (e.g., 'second', 'gpu_hour') */
  unit: string;
  /** Function to calculate cost based on value */
  calculate: (value: number) => number;
}
