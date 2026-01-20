import { beforeEach, describe, expect, it } from 'vitest';
import { CreditsSDK } from '../src/client';
import { InsufficientCreditsError, TransactionError } from '../src/errors';

// Note: These tests require a valid Upstash Redis instance
// Set UPSTASH_REDIS_URL and UPSTASH_REDIS_TOKEN environment variables

const REDIS_URL = process.env.UPSTASH_REDIS_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_TOKEN || '';

const skipIfNoRedis = !REDIS_URL || !REDIS_TOKEN;

describe.skipIf(skipIfNoRedis)('CreditsSDK', () => {
  let sdk: CreditsSDK;
  let testUserId: string;

  beforeEach(() => {
    // Generate unique user ID for each test to prevent data pollution
    testUserId = `test-user-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    sdk = new CreditsSDK({
      url: REDIS_URL,
      token: REDIS_TOKEN,
      options: {
        defaultCredits: 100,
      },
    });
  });

  describe('User Initialization', () => {
    it('should initialize user with default credits', async () => {
      const result = await sdk.initializeUser(testUserId);

      expect(result.balance).toBe(100);
      expect(result.txId).toBeDefined();
      expect(result.timestamp).toBeGreaterThan(0);

      const balance = await sdk.getBalance(testUserId);
      expect(balance).toBe(100);
    });

    it('should initialize user with custom credits', async () => {
      const customUserId = `${testUserId}-custom`;
      const result = await sdk.initializeUser(customUserId, 500);

      expect(result.balance).toBe(500);

      const balance = await sdk.getBalance(customUserId);
      expect(balance).toBe(500);
    });

    it('should not reinitialize existing user', async () => {
      await sdk.initializeUser(testUserId, 100);
      const result = await sdk.initializeUser(testUserId, 200);

      // Should return existing balance, not reinitialize
      expect(result.balance).toBe(100);
      expect(result.txId).toBe('already_initialized');
    });

    it('should throw error for negative starting credits', async () => {
      await expect(sdk.initializeUser(testUserId, -100)).rejects.toThrow(TransactionError);
    });

    it('should throw error for non-finite starting credits', async () => {
      await expect(sdk.initializeUser(testUserId, Number.POSITIVE_INFINITY)).rejects.toThrow(
        TransactionError
      );
    });

    it('should handle concurrent initialization without race condition', async () => {
      const concurrentUserId = `${testUserId}-concurrent`;

      // Simulate concurrent initialization attempts from multiple sources
      const results = await Promise.allSettled([
        sdk.initializeUser(concurrentUserId, 100),
        sdk.initializeUser(concurrentUserId, 100),
        sdk.initializeUser(concurrentUserId, 100),
      ]);

      // All should succeed (no errors)
      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      expect(succeeded).toBe(3);

      // Only one should actually create the user, others should return already_initialized
      const actualInits = results.filter(
        (r) => r.status === 'fulfilled' && r.value.txId !== 'already_initialized'
      ).length;
      expect(actualInits).toBe(1);

      // Final balance should be 100 (not 300 from triple initialization)
      const finalBalance = await sdk.getBalance(concurrentUserId);
      expect(finalBalance).toBe(100);

      // Transaction log should have only one initialization
      const transactions = await sdk.getTransactions(concurrentUserId);
      const initTransactions = transactions.filter((tx) => tx.action === 'user_initialized');
      expect(initTransactions.length).toBe(1);
    });
  });

  describe('Credit Deductions', () => {
    beforeEach(async () => {
      await sdk.initializeUser(testUserId, 100);
    });

    it('should deduct credits successfully', async () => {
      const result = await sdk.deduct(testUserId, 10, 'test_action');

      expect(result.balance).toBe(90);
      expect(result.txId).toMatch(/^tx_/);

      const balance = await sdk.getBalance(testUserId);
      expect(balance).toBe(90);
    });

    it('should deduct credits with metadata', async () => {
      const metadata = {
        app: 'test-app',
        model: 'test-model',
      };

      await sdk.deduct(testUserId, 10, 'test_action', metadata);

      const transactions = await sdk.getTransactions(testUserId);
      const latestTx = transactions[0];

      expect(latestTx?.metadata).toEqual(metadata);
    });

    it('should throw InsufficientCreditsError when balance too low', async () => {
      await expect(sdk.deduct(testUserId, 200, 'test_action')).rejects.toThrow(
        InsufficientCreditsError
      );
    });

    it('should include correct available balance in InsufficientCreditsError', async () => {
      // User was initialized with 100 credits
      const currentBalance = await sdk.getBalance(testUserId);
      expect(currentBalance).toBe(100);

      try {
        // Try to deduct 200 credits (need 100 more)
        await sdk.deduct(testUserId, 200, 'test_action');
        expect.fail('Should have thrown InsufficientCreditsError');
      } catch (error) {
        expect(error).toBeInstanceOf(InsufficientCreditsError);
        if (error instanceof InsufficientCreditsError) {
          expect(error.required).toBe(200);
          expect(error.available).toBe(100); // NOT NaN!
          expect(error.message).toContain('required 200');
          expect(error.message).toContain('available 100');
        }
      }
    });

    it('should handle edge case where user has 0 credits', async () => {
      const zeroUserId = `${testUserId}-zero`;
      await sdk.initializeUser(zeroUserId, 0);

      try {
        await sdk.deduct(zeroUserId, 50, 'test_action');
        expect.fail('Should have thrown InsufficientCreditsError');
      } catch (error) {
        expect(error).toBeInstanceOf(InsufficientCreditsError);
        if (error instanceof InsufficientCreditsError) {
          expect(error.available).toBe(0); // NOT NaN!
          expect(error.required).toBe(50);
        }
      }
    });

    it('should throw error for negative deduction amount', async () => {
      await expect(sdk.deduct(testUserId, -10, 'test_action')).rejects.toThrow(TransactionError);
    });

    it('should handle concurrent deductions without race condition', async () => {
      // Simulate concurrent deductions from multiple apps
      const results = await Promise.allSettled([
        sdk.deduct(testUserId, 60, 'app1'),
        sdk.deduct(testUserId, 60, 'app2'),
      ]);

      // One should succeed, one should fail
      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;

      expect(succeeded).toBe(1);
      expect(failed).toBe(1);

      // Final balance should be 40 (not negative or incorrect)
      const finalBalance = await sdk.getBalance(testUserId);
      expect(finalBalance).toBe(40);
    });
  });

  describe('Credit Additions', () => {
    beforeEach(async () => {
      await sdk.initializeUser(testUserId, 100);
    });

    it('should add credits successfully', async () => {
      const result = await sdk.add(testUserId, 50, 'purchase');

      expect(result.balance).toBe(150);

      const balance = await sdk.getBalance(testUserId);
      expect(balance).toBe(150);
    });

    it('should add credits with metadata', async () => {
      const metadata = {
        payment_id: 'pay_123',
        amount_usd: 10,
      };

      await sdk.add(testUserId, 100, 'purchase', metadata);

      const transactions = await sdk.getTransactions(testUserId);
      const purchaseTx = transactions.find((tx) => tx.action === 'purchase');

      expect(purchaseTx?.metadata).toEqual(metadata);
    });

    it('should throw error for negative add amount', async () => {
      await expect(sdk.add(testUserId, -50, 'test_action')).rejects.toThrow(TransactionError);
    });
  });

  describe('Transaction History', () => {
    beforeEach(async () => {
      await sdk.initializeUser(testUserId, 100);
    });

    it('should retrieve transaction history', async () => {
      await sdk.deduct(testUserId, 10, 'action1');
      await sdk.add(testUserId, 50, 'action2');
      await sdk.deduct(testUserId, 20, 'action3');

      const transactions = await sdk.getTransactions(testUserId);

      expect(transactions.length).toBeGreaterThanOrEqual(3);
      expect(transactions.length).toBeGreaterThan(0); // Ensure not empty
      // Transactions should be sorted newest first
      expect(transactions[0]?.action).toBe('action3');
    });

    it('should limit transaction history', async () => {
      await sdk.deduct(testUserId, 10, 'action1');
      await sdk.add(testUserId, 50, 'action2');
      await sdk.deduct(testUserId, 20, 'action3');

      const transactions = await sdk.getTransactions(testUserId, { limit: 2 });

      expect(transactions.length).toBeLessThanOrEqual(2);
    });

    it('should retrieve latest transactions without time filter', async () => {
      // Create 10 transactions over 1 second
      for (let i = 0; i < 10; i++) {
        await sdk.deduct(testUserId, 1, `action${i}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const txs = await sdk.getTransactions(testUserId);

      expect(txs.length).toBeGreaterThan(0); // Should NOT be empty!
      expect(txs[0]?.action).toBe('action9'); // Newest first
    });

    it('should filter transactions by time range', async () => {
      await sdk.initializeUser(testUserId, 100);
      await sdk.deduct(testUserId, 10, 'before');
      await new Promise((resolve) => setTimeout(resolve, 100));

      const rangeStart = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await sdk.deduct(testUserId, 20, 'during');
      await new Promise((resolve) => setTimeout(resolve, 100));
      const rangeEnd = Date.now();

      await new Promise((resolve) => setTimeout(resolve, 100));
      await sdk.deduct(testUserId, 30, 'after');

      const txs = await sdk.getTransactions(testUserId, {
        startTime: rangeStart,
        endTime: rangeEnd,
      });

      expect(txs.length).toBe(1);
      expect(txs[0]?.action).toBe('during');
    });

    it('should respect limit parameter without time range', async () => {
      for (let i = 0; i < 20; i++) {
        await sdk.deduct(testUserId, 1, `action${i}`);
      }

      const txs = await sdk.getTransactions(testUserId, { limit: 5 });

      expect(txs.length).toBe(5);
    });
  });

  describe('Balance Verification', () => {
    beforeEach(async () => {
      await sdk.initializeUser(testUserId, 100);
    });

    it('should verify balance matches transaction log', async () => {
      await sdk.deduct(testUserId, 10, 'action1');
      await sdk.add(testUserId, 50, 'action2');

      const verification = await sdk.verifyBalance(testUserId);

      expect(verification.valid).toBe(true);
      expect(verification.cached).toBe(140);
      expect(verification.calculated).toBe(140);
      expect(verification.difference).toBe(0);
    });

    it('should rebuild balance when inconsistent', async () => {
      await sdk.deduct(testUserId, 10, 'action1');

      // Note: In real scenarios, you'd manually corrupt the balance in Redis
      // Here we just verify the rebuild function works
      const correctedBalance = await sdk.rebuildBalance(testUserId);

      expect(correctedBalance).toBeGreaterThanOrEqual(0);

      const verification = await sdk.verifyBalance(testUserId);
      expect(verification.valid).toBe(true);
    });
  });

  describe('Balance Queries', () => {
    it('should return 0 for non-existent user', async () => {
      const balance = await sdk.getBalance('non-existent-user');
      expect(balance).toBe(0);
    });

    it('should return correct balance for initialized user', async () => {
      await sdk.initializeUser(testUserId, 250);
      const balance = await sdk.getBalance(testUserId);
      expect(balance).toBe(250);
    });
  });
});
