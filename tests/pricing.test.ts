import { beforeEach, describe, expect, it } from 'vitest';
import { PricingConfigError } from '../src/errors';
import { FIXED_PRICING, PRICING_CONFIG, PricingEngine } from '../src/pricing';

describe('PricingEngine', () => {
  let engine: PricingEngine;

  beforeEach(() => {
    engine = new PricingEngine();
  });

  describe('Video Generation Pricing', () => {
    it('should calculate cost for video generation', () => {
      const cost = engine.calculateCost('video_generation', 30);
      expect(cost).toBe(300); // 30 seconds * 10 credits/second
    });

    it('should round up fractional seconds', () => {
      const cost = engine.calculateCost('video_generation', 5.5);
      expect(cost).toBe(55); // Ceiling of 5.5 * 10
    });
  });

  describe('Training Job Pricing', () => {
    it('should calculate cost for training job', () => {
      const cost = engine.calculateCost('training_job', 2);
      expect(cost).toBe(2000); // 2 hours * 1000 credits/hour
    });

    it('should round up fractional hours', () => {
      const cost = engine.calculateCost('training_job', 1.5);
      expect(cost).toBe(1500); // Ceiling of 1.5 * 1000
    });
  });

  describe('Error Handling', () => {
    it('should throw error for unknown action', () => {
      expect(() => {
        engine.calculateCost('unknown_action', 10);
      }).toThrow(PricingConfigError);
    });

    it('should throw error for negative value', () => {
      expect(() => {
        engine.calculateCost('video_generation', -10);
      }).toThrow(PricingConfigError);
    });
  });

  describe('Config Management', () => {
    it('should check if pricing config exists', () => {
      expect(engine.hasPricingConfig('video_generation')).toBe(true);
      expect(engine.hasPricingConfig('unknown_action')).toBe(false);
    });

    it('should get pricing config', () => {
      const config = engine.getPricingConfig('video_generation');
      expect(config.rate).toBe(10);
      expect(config.unit).toBe('second');
    });

    it('should allow custom pricing config', () => {
      const customEngine = new PricingEngine({
        custom_action: {
          rate: 5,
          unit: 'item',
          calculate: (value: number) => value * 5,
        },
      });

      const cost = customEngine.calculateCost('custom_action', 10);
      expect(cost).toBe(50);
    });

    it('should allow setting pricing config', () => {
      engine.setPricingConfig('new_action', {
        rate: 15,
        unit: 'unit',
        calculate: (value: number) => value * 15,
      });

      expect(engine.hasPricingConfig('new_action')).toBe(true);
      const cost = engine.calculateCost('new_action', 10);
      expect(cost).toBe(150);
    });
  });

  describe('Fixed Pricing', () => {
    it('should have correct fixed pricing values', () => {
      expect(FIXED_PRICING.chat_message).toBe(10);
      expect(FIXED_PRICING.canvas_generation_simple).toBe(50);
      expect(FIXED_PRICING.canvas_generation_complex).toBe(75);
    });
  });

  describe('Pricing Config', () => {
    it('should have correct video generation config', () => {
      const config = PRICING_CONFIG.video_generation;
      expect(config.rate).toBe(10);
      expect(config.unit).toBe('second');
      expect(config.calculate(10)).toBe(100);
    });

    it('should have correct training job config', () => {
      const config = PRICING_CONFIG.training_job;
      expect(config.rate).toBe(1000);
      expect(config.unit).toBe('gpu_hour');
      expect(config.calculate(2)).toBe(2000);
    });
  });
});
