/**
 * Transaction History Component
 *
 * Displays a list of recent credit transactions
 *
 * Usage:
 *   import { TransactionHistory } from '@/components/transaction-history';
 *
 *   <TransactionHistory limit={20} />
 */

'use client';

import type { Transaction } from '@sparked/credits-sdk';
import { useEffect, useState } from 'react';

interface TransactionHistoryProps {
  /** Number of transactions to display (default: 20) */
  limit?: number;
  /** Custom className for styling */
  className?: string;
}

export function TransactionHistory({ limit = 20, className }: TransactionHistoryProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTransactions = async () => {
      try {
        const res = await fetch(`/api/credits/history?limit=${limit}`);

        if (!res.ok) {
          throw new Error('Failed to fetch transactions');
        }

        const data = await res.json();
        setTransactions(data.transactions);
        setError(null);
      } catch (err) {
        console.error('Failed to fetch transactions:', err);
        setError('Failed to load transaction history');
      } finally {
        setLoading(false);
      }
    };

    fetchTransactions();
  }, [limit]);

  if (loading) {
    return (
      <div className={className}>
        <h2 className="text-lg font-semibold mb-4">Transaction History</h2>
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="animate-pulse bg-muted rounded-lg h-16 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={className}>
        <h2 className="text-lg font-semibold mb-4">Transaction History</h2>
        <div className="text-sm text-destructive">{error}</div>
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className={className}>
        <h2 className="text-lg font-semibold mb-4">Transaction History</h2>
        <div className="text-sm text-muted-foreground">No transactions yet</div>
      </div>
    );
  }

  return (
    <div className={className}>
      <h2 className="text-lg font-semibold mb-4">Transaction History</h2>
      <div className="divide-y divide-border">
        {transactions.map((tx) => (
          <TransactionRow key={tx.id} transaction={tx} />
        ))}
      </div>
    </div>
  );
}

function TransactionRow({ transaction }: { transaction: Transaction }) {
  const isPositive = transaction.amount > 0;
  const date = new Date(transaction.timestamp);

  return (
    <div className="py-3 flex justify-between items-start gap-4">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">{formatActionName(transaction.action)}</div>
        <div className="text-xs text-muted-foreground">
          {date.toLocaleDateString()} at {date.toLocaleTimeString()}
        </div>
        {transaction.metadata && Object.keys(transaction.metadata).length > 0 && (
          <div className="text-xs text-muted-foreground mt-1">
            {formatMetadata(transaction.metadata)}
          </div>
        )}
      </div>
      <div
        className={`font-semibold tabular-nums ${isPositive ? 'text-green-600' : 'text-red-600'}`}
      >
        {isPositive ? '+' : ''}
        {transaction.amount.toLocaleString()}
      </div>
    </div>
  );
}

function formatActionName(action: string): string {
  // Convert snake_case to Title Case
  return action
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatMetadata(metadata: Record<string, any>): string {
  const entries = Object.entries(metadata);
  if (entries.length === 0) return '';

  // Show first 2 metadata entries
  const display = entries
    .slice(0, 2)
    .map(([key, value]) => {
      if (key === 'app') return null; // Hide app field
      return `${key}: ${value}`;
    })
    .filter(Boolean)
    .join(', ');

  return display;
}
