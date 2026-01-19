/**
 * Configuration options for the Credits SDK
 */
interface CreditsConfig {
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
interface Transaction {
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
interface TransactionResult {
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
interface TransactionQueryOptions {
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
interface BalanceVerification {
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
interface PricingConfig {
    /** Cost per unit */
    rate: number;
    /** Unit of measurement (e.g., 'second', 'gpu_hour') */
    unit: string;
    /** Function to calculate cost based on value */
    calculate: (value: number) => number;
}

/**
 * Main Credits SDK client for managing user credits across multiple applications
 *
 * Features:
 * - Atomic credit deductions using Lua scripts
 * - Event sourcing with transaction log
 * - Balance reconciliation
 * - Shared balance across multiple apps
 */
declare class CreditsSDK {
    private redis;
    private defaultCredits;
    constructor(config: CreditsConfig);
    /**
     * Initialize a new user with default credits
     * Uses Lua script to prevent race conditions during concurrent initialization
     *
     * @param userId - The user ID
     * @param credits - Optional custom starting credits (defaults to config.defaultCredits)
     * @returns The transaction result
     */
    initializeUser(userId: string, credits?: number): Promise<TransactionResult>;
    /**
     * Deduct credits from a user's balance atomically
     * Uses Lua script to prevent race conditions
     *
     * @param userId - The user ID
     * @param amount - Amount of credits to deduct (must be positive)
     * @param action - Action type (e.g., 'chat_message', 'video_generation')
     * @param metadata - Optional metadata to store with the transaction
     * @returns The transaction result
     * @throws {InsufficientCreditsError} If user has insufficient credits
     * @throws {TransactionError} If the transaction fails
     */
    deduct(userId: string, amount: number, action: string, metadata?: Record<string, any>): Promise<TransactionResult>;
    /**
     * Add credits to a user's balance
     * Used for purchases, refunds, admin grants, etc.
     *
     * @param userId - The user ID
     * @param amount - Amount of credits to add (must be positive)
     * @param action - Action type (e.g., 'purchase', 'refund', 'admin_grant')
     * @param metadata - Optional metadata to store with the transaction
     * @returns The transaction result
     */
    add(userId: string, amount: number, action: string, metadata?: Record<string, any>): Promise<TransactionResult>;
    /**
     * Get a user's current balance
     * O(1) operation - reads from cached value
     *
     * @param userId - The user ID
     * @returns The current balance (0 if user not found)
     */
    getBalance(userId: string): Promise<number>;
    /**
     * Get transaction history for a user
     *
     * @param userId - The user ID
     * @param options - Query options
     * @returns Array of transactions, sorted by timestamp (newest first)
     */
    getTransactions(userId: string, options?: TransactionQueryOptions): Promise<Transaction[]>;
    /**
     * Verify that cached balance matches transaction log
     * Used for reconciliation and detecting inconsistencies
     *
     * @param userId - The user ID
     * @returns Balance verification result
     */
    verifyBalance(userId: string): Promise<BalanceVerification>;
    /**
     * Rebuild balance from transaction log
     * Used to fix inconsistencies detected by verifyBalance()
     *
     * @param userId - The user ID
     * @returns The corrected balance
     * @throws {BalanceVerificationError} If verification fails after rebuild
     */
    rebuildBalance(userId: string): Promise<number>;
    /**
     * Calculate balance by summing all transactions
     * Used for reconciliation
     *
     * @param userId - The user ID
     * @returns The calculated balance
     */
    private calculateBalanceFromTransactions;
    /**
     * Generate Redis key for user balance
     */
    private getBalanceKey;
    /**
     * Generate Redis key for user transactions
     */
    private getTransactionsKey;
    /**
     * Generate unique transaction ID
     */
    private generateTxId;
    /**
     * Validate userId to prevent injection and data corruption
     * @throws {TransactionError} If userId is invalid
     */
    private validateUserId;
}

/**
 * Error thrown when a user has insufficient credits for an operation
 *
 * @property {number} required - The amount of credits required for the operation
 * @property {number} available - The current available balance (guaranteed to be a number, defaults to 0 if parsing fails)
 */
declare class InsufficientCreditsError extends Error {
    required: number;
    available: number;
    constructor(required: number, available: number);
}
/**
 * Error thrown when a transaction fails
 */
declare class TransactionError extends Error {
    txId?: string | undefined;
    constructor(message: string, txId?: string | undefined);
}
/**
 * Error thrown when balance verification fails
 */
declare class BalanceVerificationError extends Error {
    userId: string;
    cached: number;
    calculated: number;
    constructor(message: string, userId: string, cached: number, calculated: number);
}
/**
 * Error thrown when pricing configuration is missing or invalid
 */
declare class PricingConfigError extends Error {
    action?: string | undefined;
    constructor(message: string, action?: string | undefined);
}

/**
 * Pricing configuration for metered operations
 *
 * Video generation: 10 credits per second
 * Training jobs: 1000 credits per GPU hour
 */
declare const PRICING_CONFIG: Record<string, PricingConfig>;
/**
 * Fixed pricing for non-metered operations
 * Used by chat and canvas applications
 */
declare const FIXED_PRICING: {
    readonly chat_message: 10;
    readonly canvas_generation_simple: 50;
    readonly canvas_generation_complex: 75;
};
/**
 * Engine for calculating costs for metered operations
 */
declare class PricingEngine {
    private config;
    constructor(customConfig?: Record<string, PricingConfig>);
    /**
     * Calculate cost for a metered action
     * @param action - The action type (e.g., 'video_generation')
     * @param value - The value to calculate cost for (e.g., duration in seconds)
     * @returns The calculated cost in credits
     * @throws {PricingConfigError} If no pricing config exists for the action
     */
    calculateCost(action: string, value: number): number;
    /**
     * Get pricing configuration for an action
     * @param action - The action type
     * @returns The pricing configuration
     * @throws {PricingConfigError} If no pricing config exists for the action
     */
    getPricingConfig(action: string): PricingConfig;
    /**
     * Check if pricing configuration exists for an action
     * @param action - The action type
     * @returns True if configuration exists
     */
    hasPricingConfig(action: string): boolean;
    /**
     * Add or update pricing configuration for an action
     * @param action - The action type
     * @param config - The pricing configuration
     */
    setPricingConfig(action: string, config: PricingConfig): void;
}

export { type BalanceVerification, BalanceVerificationError, type CreditsConfig, CreditsSDK, FIXED_PRICING, InsufficientCreditsError, PRICING_CONFIG, type PricingConfig, PricingConfigError, PricingEngine, type Transaction, TransactionError, type TransactionQueryOptions, type TransactionResult };
