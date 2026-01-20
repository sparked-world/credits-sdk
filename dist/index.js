"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  BalanceVerificationError: () => BalanceVerificationError,
  CreditsSDK: () => CreditsSDK,
  FIXED_PRICING: () => FIXED_PRICING,
  InsufficientCreditsError: () => InsufficientCreditsError,
  PRICING_CONFIG: () => PRICING_CONFIG,
  PricingConfigError: () => PricingConfigError,
  PricingEngine: () => PricingEngine,
  TransactionError: () => TransactionError
});
module.exports = __toCommonJS(index_exports);

// src/client.ts
var import_redis = require("@upstash/redis");

// src/errors.ts
var InsufficientCreditsError = class _InsufficientCreditsError extends Error {
  constructor(required, available) {
    super(`Insufficient credits: required ${required}, available ${available}`);
    this.required = required;
    this.available = available;
    this.name = "InsufficientCreditsError";
    Object.setPrototypeOf(this, _InsufficientCreditsError.prototype);
  }
};
var TransactionError = class _TransactionError extends Error {
  constructor(message, txId) {
    super(message);
    this.txId = txId;
    this.name = "TransactionError";
    Object.setPrototypeOf(this, _TransactionError.prototype);
  }
};
var BalanceVerificationError = class _BalanceVerificationError extends Error {
  constructor(message, userId, cached, calculated) {
    super(message);
    this.userId = userId;
    this.cached = cached;
    this.calculated = calculated;
    this.name = "BalanceVerificationError";
    Object.setPrototypeOf(this, _BalanceVerificationError.prototype);
  }
};
var PricingConfigError = class _PricingConfigError extends Error {
  constructor(message, action) {
    super(message);
    this.action = action;
    this.name = "PricingConfigError";
    Object.setPrototypeOf(this, _PricingConfigError.prototype);
  }
};

// src/client.ts
var CreditsSDK = class {
  constructor(config) {
    this.redis = new import_redis.Redis({
      url: config.url,
      token: config.token
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
  async initializeUser(userId, credits) {
    this.validateUserId(userId);
    const startingCredits = credits ?? this.defaultCredits;
    if (startingCredits < 0) {
      throw new TransactionError("Starting credits must be non-negative");
    }
    if (!Number.isFinite(startingCredits)) {
      throw new TransactionError("Starting credits must be a finite number");
    }
    const balanceKey = this.getBalanceKey(userId);
    const txsKey = this.getTransactionsKey(userId);
    const txId = this.generateTxId();
    const timestamp = Date.now();
    const transaction = {
      id: txId,
      amount: startingCredits,
      action: "user_initialized",
      metadata: {
        starting_credits: startingCredits
      },
      timestamp
    };
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
      const result = await this.redis.eval(
        luaScript,
        [balanceKey, txsKey],
        [startingCredits, JSON.stringify(transaction), timestamp]
      );
      const [balance, alreadyExists] = result;
      if (alreadyExists) {
        return {
          txId: "already_initialized",
          balance,
          timestamp: Date.now()
        };
      }
      return {
        txId,
        balance,
        timestamp
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
  async deduct(userId, amount, action, metadata) {
    this.validateUserId(userId);
    if (amount <= 0) {
      throw new TransactionError("Deduct amount must be positive and non-zero");
    }
    if (!Number.isFinite(amount)) {
      throw new TransactionError("Deduct amount must be a finite number");
    }
    if (!action || typeof action !== "string" || action.trim().length === 0) {
      throw new TransactionError("action is required and must be a non-empty string");
    }
    const balanceKey = this.getBalanceKey(userId);
    const txsKey = this.getTransactionsKey(userId);
    const txId = this.generateTxId();
    const timestamp = Date.now();
    const transaction = {
      id: txId,
      amount: -amount,
      // Negative for deductions
      action,
      metadata,
      timestamp
    };
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
        timestamp
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("INSUFFICIENT_CREDITS")) {
        const match = error.message.match(/INSUFFICIENT_CREDITS:?\s*(\d+(?:\.\d+)?)/);
        const availableBalance = parseFloat(match?.[1] ?? "0");
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
  async add(userId, amount, action, metadata) {
    this.validateUserId(userId);
    if (amount <= 0) {
      throw new TransactionError("Add amount must be positive and non-zero");
    }
    if (!Number.isFinite(amount)) {
      throw new TransactionError("Add amount must be a finite number");
    }
    if (!action || typeof action !== "string" || action.trim().length === 0) {
      throw new TransactionError("action is required and must be a non-empty string");
    }
    const balanceKey = this.getBalanceKey(userId);
    const txsKey = this.getTransactionsKey(userId);
    const txId = this.generateTxId();
    const timestamp = Date.now();
    const transaction = {
      id: txId,
      amount,
      // Positive for additions
      action,
      metadata,
      timestamp
    };
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
        timestamp
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
  async getBalance(userId) {
    this.validateUserId(userId);
    const balanceKey = this.getBalanceKey(userId);
    const balance = await this.redis.get(balanceKey);
    return balance ?? 0;
  }
  /**
   * Get transaction history for a user
   *
   * @param userId - The user ID
   * @param options - Query options
   * @returns Array of transactions, sorted by timestamp (newest first)
   */
  async getTransactions(userId, options = {}) {
    this.validateUserId(userId);
    const txsKey = this.getTransactionsKey(userId);
    const { limit = 50, startTime, endTime } = options;
    if (limit <= 0 || !Number.isInteger(limit)) {
      throw new TransactionError("limit must be a positive integer");
    }
    const MAX_RESULTS = 1e3;
    const effectiveLimit = Math.min(limit, MAX_RESULTS);
    let results;
    if (startTime === void 0 && endTime === void 0) {
      results = await this.redis.zrange(txsKey, 0, effectiveLimit - 1, {
        rev: true
        // Newest first
      });
    } else {
      const min = startTime ?? 0;
      const max = endTime ?? Date.now();
      const allResults = await this.redis.zrange(txsKey, max, min, {
        byScore: true,
        rev: true
      });
      if (allResults.length > effectiveLimit) {
        console.warn(
          `[CreditsSDK] Transaction query for user ${userId} returned ${allResults.length} results, limiting to ${effectiveLimit}. Consider using narrower time ranges or pagination.`
        );
      }
      results = allResults.slice(0, effectiveLimit);
    }
    return results.map((txData) => {
      try {
        if (typeof txData === "string") {
          return JSON.parse(txData);
        }
        return txData;
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
  async verifyBalance(userId) {
    this.validateUserId(userId);
    const balanceKey = this.getBalanceKey(userId);
    const cachedBalance = await this.redis.get(balanceKey) ?? 0;
    const calculatedBalance = await this.calculateBalanceFromTransactions(userId);
    const difference = cachedBalance - calculatedBalance;
    const valid = difference === 0;
    return {
      valid,
      cached: cachedBalance,
      calculated: calculatedBalance,
      difference
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
  async rebuildBalance(userId) {
    this.validateUserId(userId);
    const balanceKey = this.getBalanceKey(userId);
    const correctBalance = await this.calculateBalanceFromTransactions(userId);
    await this.redis.set(balanceKey, correctBalance);
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
  async calculateBalanceFromTransactions(userId) {
    const txsKey = this.getTransactionsKey(userId);
    const results = await this.redis.zrange(txsKey, 0, -1);
    return results.reduce((sum, txData) => {
      try {
        const tx = typeof txData === "string" ? JSON.parse(txData) : txData;
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
  getBalanceKey(userId) {
    return `balance:${userId}`;
  }
  /**
   * Generate Redis key for user transactions
   */
  getTransactionsKey(userId) {
    return `txs:${userId}`;
  }
  /**
   * Generate unique transaction ID
   */
  generateTxId() {
    return `tx_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
  /**
   * Validate userId to prevent injection and data corruption
   * @throws {TransactionError} If userId is invalid
   */
  validateUserId(userId) {
    if (!userId || typeof userId !== "string") {
      throw new TransactionError("userId is required and must be a string");
    }
    const trimmedUserId = userId.trim();
    if (trimmedUserId.length === 0) {
      throw new TransactionError("userId cannot be empty or whitespace");
    }
    if (trimmedUserId.length > 256) {
      throw new TransactionError("userId cannot exceed 256 characters");
    }
    if (trimmedUserId.includes("\n") || trimmedUserId.includes("\r")) {
      throw new TransactionError("userId cannot contain newline characters");
    }
  }
};

// src/pricing.ts
var PRICING_CONFIG = {
  video_generation: {
    rate: 10,
    unit: "second",
    calculate: (seconds) => Math.ceil(seconds * 10)
  },
  training_job: {
    rate: 1e3,
    unit: "gpu_hour",
    calculate: (hours) => Math.ceil(hours * 1e3)
  }
};
var FIXED_PRICING = {
  chat_message: 10,
  canvas_generation_simple: 50,
  canvas_generation_complex: 75
};
var PricingEngine = class {
  constructor(customConfig) {
    this.config = customConfig || PRICING_CONFIG;
  }
  /**
   * Calculate cost for a metered action
   * @param action - The action type (e.g., 'video_generation')
   * @param value - The value to calculate cost for (e.g., duration in seconds)
   * @returns The calculated cost in credits
   * @throws {PricingConfigError} If no pricing config exists for the action
   */
  calculateCost(action, value) {
    const config = this.config[action];
    if (!config) {
      throw new PricingConfigError(`No pricing configuration found for action: ${action}`, action);
    }
    if (value < 0) {
      throw new PricingConfigError(`Value must be non-negative, got: ${value}`, action);
    }
    return config.calculate(value);
  }
  /**
   * Get pricing configuration for an action
   * @param action - The action type
   * @returns The pricing configuration
   * @throws {PricingConfigError} If no pricing config exists for the action
   */
  getPricingConfig(action) {
    const config = this.config[action];
    if (!config) {
      throw new PricingConfigError(`No pricing configuration found for action: ${action}`, action);
    }
    return config;
  }
  /**
   * Check if pricing configuration exists for an action
   * @param action - The action type
   * @returns True if configuration exists
   */
  hasPricingConfig(action) {
    return action in this.config;
  }
  /**
   * Add or update pricing configuration for an action
   * @param action - The action type
   * @param config - The pricing configuration
   */
  setPricingConfig(action, config) {
    this.config[action] = config;
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BalanceVerificationError,
  CreditsSDK,
  FIXED_PRICING,
  InsufficientCreditsError,
  PRICING_CONFIG,
  PricingConfigError,
  PricingEngine,
  TransactionError
});
