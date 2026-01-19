import { Redis } from '@upstash/redis';
import { BalanceVerificationError, InsufficientCreditsError, TransactionError } from './errors';
import type {
  BalanceVerification,
  CreditsConfig,
  Transaction,
  TransactionQueryOptions,
  TransactionResult,
} from './types';

/**
 * Main Credits SDK client for managing user credits across multiple applications
 *
 * Features:
 * - Atomic credit deductions using Lua scripts
 * - Event sourcing with transaction log
 * - Balance reconciliation
 * - Shared balance across multiple apps
 */
export class CreditsSDK {
  private redis: Redis;
  private defaultCredits: number;

  constructor(config: CreditsConfig) {
    this.redis = new Redis({
      url: config.url,
      token: config.token,
    });
    this.defaultCredits = config.options?.defaultCredits || 100;
  }

  /**
   * Initialize a new user with default credits
   * Uses Lua script to prevent race conditions during concurrent initialization
   *
   * @param userId - The user ID
   * @param credits - Optional custom starting credits (defaults to config.defaultCredits)
   * @returns The transaction result
   */
  async initializeUser(userId: string, credits?: number): Promise<TransactionResult> {
    this.validateUserId(userId);

    const startingCredits = credits ?? this.defaultCredits;

    // Validate starting credits
    if (startingCredits < 0) {
      throw new TransactionError('Starting credits must be non-negative');
    }

    if (!Number.isFinite(startingCredits)) {
      throw new TransactionError('Starting credits must be a finite number');
    }

    const balanceKey = this.getBalanceKey(userId);
    const txsKey = this.getTransactionsKey(userId);
    const txId = this.generateTxId();
    const timestamp = Date.now();

    const transaction: Transaction = {
      id: txId,
      amount: startingCredits,
      action: 'user_initialized',
      metadata: {
        starting_credits: startingCredits,
      },
      timestamp,
    };

    // Lua script for atomic initialization
    // Prevents race condition when multiple webhook events occur simultaneously
    const luaScript = `
      local balance_key = KEYS[1]
      local txs_key = KEYS[2]
      local starting_credits = tonumber(ARGV[1])
      local tx_data = ARGV[2]
      local timestamp = tonumber(ARGV[3])

      -- Check if user already exists
      local existing_balance = redis.call('GET', balance_key)
      if existing_balance then
        return {tonumber(existing_balance), 1}
      end

      -- Initialize user atomically
      redis.call('SET', balance_key, starting_credits)
      redis.call('ZADD', txs_key, timestamp, tx_data)

      return {starting_credits, 0}
    `;

    try {
      const result = (await this.redis.eval(
        luaScript,
        [balanceKey, txsKey],
        [startingCredits, JSON.stringify(transaction), timestamp]
      )) as [number, number];

      const [balance, alreadyExists] = result;

      if (alreadyExists) {
        return {
          txId: 'already_initialized',
          balance,
          timestamp: Date.now(),
        };
      }

      return {
        txId,
        balance,
        timestamp,
      };
    } catch (error) {
      throw new TransactionError(`User initialization failed: ${error}`, txId);
    }
  }

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
  async deduct(
    userId: string,
    amount: number,
    action: string,
    metadata?: Record<string, any>
  ): Promise<TransactionResult> {
    this.validateUserId(userId);

    if (amount <= 0) {
      throw new TransactionError('Deduct amount must be positive and non-zero');
    }

    if (!Number.isFinite(amount)) {
      throw new TransactionError('Deduct amount must be a finite number');
    }

    if (!action || typeof action !== 'string' || action.trim().length === 0) {
      throw new TransactionError('action is required and must be a non-empty string');
    }

    const balanceKey = this.getBalanceKey(userId);
    const txsKey = this.getTransactionsKey(userId);
    const txId = this.generateTxId();
    const timestamp = Date.now();

    const transaction: Transaction = {
      id: txId,
      amount: -amount, // Negative for deductions
      action,
      metadata,
      timestamp,
    };

    // Lua script for atomic deduction
    // This prevents race conditions when multiple apps deduct simultaneously
    const luaScript = `
      local balance_key = KEYS[1]
      local txs_key = KEYS[2]
      local amount = tonumber(ARGV[1])
      local tx_data = ARGV[2]
      local timestamp = tonumber(ARGV[3])

      -- Get current balance (default to 0 if not set)
      local balance = tonumber(redis.call('GET', balance_key) or 0)

      -- Check if sufficient credits
      if balance < amount then
        return redis.error_reply('INSUFFICIENT_CREDITS:' .. balance)
      end

      -- Deduct credits
      local new_balance = balance - amount
      redis.call('SET', balance_key, new_balance)

      -- Log transaction
      redis.call('ZADD', txs_key, timestamp, tx_data)

      return new_balance
    `;

    try {
      const result = await this.redis.eval(
        luaScript,
        [balanceKey, txsKey],
        [amount, JSON.stringify(transaction), timestamp]
      );

      const newBalance = Number(result);

      return {
        txId,
        balance: newBalance,
        timestamp,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('INSUFFICIENT_CREDITS')) {
        // Extract balance using regex to handle various formats:
        // - "INSUFFICIENT_CREDITS:30"
        // - "ERR INSUFFICIENT_CREDITS:30"
        // - "Command failed: ERR INSUFFICIENT_CREDITS:30"
        // - "INSUFFICIENT_CREDITS: 30" (with space)
        const match = error.message.match(/INSUFFICIENT_CREDITS:?\s*(\d+(?:\.\d+)?)/);
        const availableBalance = parseFloat(match?.[1] ?? '0');
        throw new InsufficientCreditsError(amount, availableBalance);
      }
      throw new TransactionError(`Deduction failed: ${error}`, txId);
    }
  }

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
  async add(
    userId: string,
    amount: number,
    action: string,
    metadata?: Record<string, any>
  ): Promise<TransactionResult> {
    this.validateUserId(userId);

    if (amount <= 0) {
      throw new TransactionError('Add amount must be positive and non-zero');
    }

    if (!Number.isFinite(amount)) {
      throw new TransactionError('Add amount must be a finite number');
    }

    if (!action || typeof action !== 'string' || action.trim().length === 0) {
      throw new TransactionError('action is required and must be a non-empty string');
    }

    const balanceKey = this.getBalanceKey(userId);
    const txsKey = this.getTransactionsKey(userId);
    const txId = this.generateTxId();
    const timestamp = Date.now();

    const transaction: Transaction = {
      id: txId,
      amount, // Positive for additions
      action,
      metadata,
      timestamp,
    };

    // Lua script for atomic addition
    const luaScript = `
      local balance_key = KEYS[1]
      local txs_key = KEYS[2]
      local amount = tonumber(ARGV[1])
      local tx_data = ARGV[2]
      local timestamp = tonumber(ARGV[3])

      -- Get current balance (default to 0 if not set)
      local balance = tonumber(redis.call('GET', balance_key) or 0)

      -- Add credits
      local new_balance = balance + amount
      redis.call('SET', balance_key, new_balance)

      -- Log transaction
      redis.call('ZADD', txs_key, timestamp, tx_data)

      return new_balance
    `;

    try {
      const result = await this.redis.eval(
        luaScript,
        [balanceKey, txsKey],
        [amount, JSON.stringify(transaction), timestamp]
      );

      const newBalance = Number(result);

      return {
        txId,
        balance: newBalance,
        timestamp,
      };
    } catch (error) {
      throw new TransactionError(`Addition failed: ${error}`, txId);
    }
  }

  /**
   * Get a user's current balance
   * O(1) operation - reads from cached value
   *
   * @param userId - The user ID
   * @returns The current balance (0 if user not found)
   */
  async getBalance(userId: string): Promise<number> {
    this.validateUserId(userId);

    const balanceKey = this.getBalanceKey(userId);
    const balance = await this.redis.get<number>(balanceKey);
    return balance ?? 0;
  }

  /**
   * Get transaction history for a user
   *
   * @param userId - The user ID
   * @param options - Query options
   * @returns Array of transactions, sorted by timestamp (newest first)
   */
  async getTransactions(
    userId: string,
    options: TransactionQueryOptions = {}
  ): Promise<Transaction[]> {
    this.validateUserId(userId);

    const txsKey = this.getTransactionsKey(userId);
    const { limit = 50, startTime, endTime } = options;

    // Query transactions by timestamp range
    const min = startTime ?? 0;
    const max = endTime ?? Date.now();

    const results = await this.redis.zrange<string[]>(txsKey, min, max, {
      byScore: true,
      rev: true, // Newest first
      offset: 0,
      count: limit,
    });

    return results.map((txStr) => {
      try {
        return JSON.parse(txStr) as Transaction;
      } catch (error) {
        throw new TransactionError(`Failed to parse transaction data: ${error}`);
      }
    });
  }

  /**
   * Verify that cached balance matches transaction log
   * Used for reconciliation and detecting inconsistencies
   *
   * @param userId - The user ID
   * @returns Balance verification result
   */
  async verifyBalance(userId: string): Promise<BalanceVerification> {
    this.validateUserId(userId);

    // Get balance directly without re-validation
    const balanceKey = this.getBalanceKey(userId);
    const cachedBalance = (await this.redis.get<number>(balanceKey)) ?? 0;
    const calculatedBalance = await this.calculateBalanceFromTransactions(userId);

    const difference = cachedBalance - calculatedBalance;
    // Credits should always be integers (see FIXED_PRICING and PRICING_CONFIG which use Math.ceil)
    // so we use exact comparison. If this fails, it indicates a real data integrity issue.
    const valid = difference === 0;

    return {
      valid,
      cached: cachedBalance,
      calculated: calculatedBalance,
      difference,
    };
  }

  /**
   * Rebuild balance from transaction log
   * Used to fix inconsistencies detected by verifyBalance()
   *
   * @param userId - The user ID
   * @returns The corrected balance
   * @throws {BalanceVerificationError} If verification fails after rebuild
   */
  async rebuildBalance(userId: string): Promise<number> {
    this.validateUserId(userId);

    const balanceKey = this.getBalanceKey(userId);
    const correctBalance = await this.calculateBalanceFromTransactions(userId);

    await this.redis.set(balanceKey, correctBalance);

    // Verify the fix
    const verification = await this.verifyBalance(userId);
    if (!verification.valid) {
      throw new BalanceVerificationError(
        `Balance rebuild failed for user ${userId}`,
        userId,
        verification.cached,
        verification.calculated
      );
    }

    return correctBalance;
  }

  /**
   * Calculate balance by summing all transactions
   * Used for reconciliation
   *
   * @param userId - The user ID
   * @returns The calculated balance
   */
  private async calculateBalanceFromTransactions(userId: string): Promise<number> {
    const txsKey = this.getTransactionsKey(userId);

    // Get all transactions
    const results = await this.redis.zrange<string[]>(txsKey, 0, -1);

    // Sum all transaction amounts
    return results.reduce((sum, txStr) => {
      try {
        const tx = JSON.parse(txStr) as Transaction;
        return sum + tx.amount;
      } catch (error) {
        throw new BalanceVerificationError(
          `Failed to parse transaction data during balance calculation: ${error}`,
          userId,
          0,
          0
        );
      }
    }, 0);
  }

  /**
   * Generate Redis key for user balance
   */
  private getBalanceKey(userId: string): string {
    return `balance:${userId}`;
  }

  /**
   * Generate Redis key for user transactions
   */
  private getTransactionsKey(userId: string): string {
    return `txs:${userId}`;
  }

  /**
   * Generate unique transaction ID
   */
  private generateTxId(): string {
    return `tx_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Validate userId to prevent injection and data corruption
   * @throws {TransactionError} If userId is invalid
   */
  private validateUserId(userId: string): void {
    if (!userId || typeof userId !== 'string') {
      throw new TransactionError('userId is required and must be a string');
    }

    const trimmedUserId = userId.trim();
    if (trimmedUserId.length === 0) {
      throw new TransactionError('userId cannot be empty or whitespace');
    }

    if (trimmedUserId.length > 256) {
      throw new TransactionError('userId cannot exceed 256 characters');
    }

    // Prevent Redis key injection - check for newlines, colons in problematic patterns
    if (trimmedUserId.includes('\n') || trimmedUserId.includes('\r')) {
      throw new TransactionError('userId cannot contain newline characters');
    }
  }
}
