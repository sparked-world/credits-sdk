/**
 * Error thrown when a user has insufficient credits for an operation
 *
 * @property {number} required - The amount of credits required for the operation
 * @property {number} available - The current available balance (guaranteed to be a number, defaults to 0 if parsing fails)
 */
export class InsufficientCreditsError extends Error {
  constructor(
    public required: number,
    public available: number
  ) {
    super(`Insufficient credits: required ${required}, available ${available}`);
    this.name = 'InsufficientCreditsError';
    Object.setPrototypeOf(this, InsufficientCreditsError.prototype);
  }
}

/**
 * Error thrown when a transaction fails
 */
export class TransactionError extends Error {
  constructor(
    message: string,
    public txId?: string
  ) {
    super(message);
    this.name = 'TransactionError';
    Object.setPrototypeOf(this, TransactionError.prototype);
  }
}

/**
 * Error thrown when balance verification fails
 */
export class BalanceVerificationError extends Error {
  constructor(
    message: string,
    public userId: string,
    public cached: number,
    public calculated: number
  ) {
    super(message);
    this.name = 'BalanceVerificationError';
    Object.setPrototypeOf(this, BalanceVerificationError.prototype);
  }
}

/**
 * Error thrown when pricing configuration is missing or invalid
 */
export class PricingConfigError extends Error {
  constructor(
    message: string,
    public action?: string
  ) {
    super(message);
    this.name = 'PricingConfigError';
    Object.setPrototypeOf(this, PricingConfigError.prototype);
  }
}
