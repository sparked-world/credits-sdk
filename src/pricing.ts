import { PricingConfigError } from './errors';
import type { PricingConfig } from './types';

/**
 * Pricing configuration for metered operations
 *
 * Video generation: 10 credits per second
 * Training jobs: 1000 credits per GPU hour
 */
export const PRICING_CONFIG: Record<string, PricingConfig> = {
  video_generation: {
    rate: 10,
    unit: 'second',
    calculate: (seconds: number) => Math.ceil(seconds * 10),
  },
  training_job: {
    rate: 1000,
    unit: 'gpu_hour',
    calculate: (hours: number) => Math.ceil(hours * 1000),
  },
};

/**
 * Fixed pricing for non-metered operations
 * Used by chat and canvas applications
 */
export const FIXED_PRICING = {
  chat_message: 10,
  canvas_generation_simple: 50,
  canvas_generation_complex: 75,
} as const;

/**
 * Engine for calculating costs for metered operations
 */
export class PricingEngine {
  private config: Record<string, PricingConfig>;

  constructor(customConfig?: Record<string, PricingConfig>) {
    this.config = customConfig || PRICING_CONFIG;
  }

  /**
   * Calculate cost for a metered action
   * @param action - The action type (e.g., 'video_generation')
   * @param value - The value to calculate cost for (e.g., duration in seconds)
   * @returns The calculated cost in credits
   * @throws {PricingConfigError} If no pricing config exists for the action
   */
  calculateCost(action: string, value: number): number {
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
  getPricingConfig(action: string): PricingConfig {
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
  hasPricingConfig(action: string): boolean {
    return action in this.config;
  }

  /**
   * Add or update pricing configuration for an action
   * @param action - The action type
   * @param config - The pricing configuration
   */
  setPricingConfig(action: string, config: PricingConfig): void {
    this.config[action] = config;
  }
}
