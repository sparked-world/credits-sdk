/**
 * Credits Balance Widget
 *
 * Displays the user's current credit balance
 *
 * Usage:
 *   import { CreditsBalance } from '@/components/credits-balance';
 *
 *   <CreditsBalance />
 */

'use client';

import { useEffect, useState } from 'react';

interface CreditsBalanceProps {
  /** Refresh interval in milliseconds (default: 30000 = 30 seconds) */
  refreshInterval?: number;
  /** Custom className for styling */
  className?: string;
  /** Show loading skeleton */
  showLoading?: boolean;
}

export function CreditsBalance({
  refreshInterval = 30000,
  className,
  showLoading = true,
}: CreditsBalanceProps) {
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBalance = async () => {
    try {
      const res = await fetch('/api/credits/balance');

      if (!res.ok) {
        throw new Error('Failed to fetch balance');
      }

      const data = await res.json();
      setBalance(data.balance);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch balance:', err);
      setError('Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBalance();

    // Set up periodic refresh
    const interval = setInterval(fetchBalance, refreshInterval);

    return () => clearInterval(interval);
  }, [refreshInterval]);

  if (loading && showLoading) {
    return (
      <div className={`animate-pulse bg-muted rounded-lg px-3 py-1 w-24 h-8 ${className || ''}`} />
    );
  }

  if (error) {
    return <div className={`text-sm text-destructive ${className || ''}`}>{error}</div>;
  }

  return (
    <div className={`flex items-center gap-2 px-3 py-1 bg-muted rounded-lg ${className || ''}`}>
      <span className="text-sm text-muted-foreground">Credits:</span>
      <span className="font-semibold text-lg tabular-nums">{balance?.toLocaleString()}</span>
    </div>
  );
}
