/**
 * Credits Usage Chart
 *
 * Displays a simple chart of credit usage over time
 *
 * Usage:
 *   import { CreditsUsageChart } from '@/components/credits-usage-chart';
 *
 *   <CreditsUsageChart days={7} />
 *
 * Note: This is a simple implementation. For production, consider using
 * a charting library like Recharts, Chart.js, or similar.
 */

'use client';

import type { Transaction } from '@sparked/credits-sdk';
import { useEffect, useState } from 'react';

interface CreditsUsageChartProps {
  /** Number of days to show (default: 7) */
  days?: number;
  /** Custom className for styling */
  className?: string;
}

interface DayData {
  date: string;
  spent: number;
  earned: number;
}

export function CreditsUsageChart({ days = 7, className }: CreditsUsageChartProps) {
  const [data, setData] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
        const res = await fetch(`/api/credits/history?startTime=${startTime}&limit=1000`);

        if (!res.ok) throw new Error('Failed to fetch');

        const { transactions } = await res.json();

        // Group transactions by day
        const dayMap = new Map<string, DayData>();

        // Initialize all days
        for (let i = 0; i < days; i++) {
          const date = new Date();
          date.setDate(date.getDate() - i);
          const dateStr = date.toISOString().split('T')[0]!;
          dayMap.set(dateStr, { date: dateStr, spent: 0, earned: 0 });
        }

        // Aggregate transactions
        transactions.forEach((tx: Transaction) => {
          const date = new Date(tx.timestamp).toISOString().split('T')[0]!;
          const day = dayMap.get(date);
          if (day) {
            if (tx.amount < 0) {
              day.spent += Math.abs(tx.amount);
            } else {
              day.earned += tx.amount;
            }
          }
        });

        const sortedData = Array.from(dayMap.values()).reverse();
        setData(sortedData);
      } catch (err) {
        console.error('Failed to fetch usage data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [days]);

  if (loading) {
    return (
      <div className={className}>
        <div className="animate-pulse bg-muted rounded-lg h-64 w-full" />
      </div>
    );
  }

  const maxValue = Math.max(...data.map((d) => Math.max(d.spent, d.earned)), 1);

  return (
    <div className={className}>
      <h3 className="text-lg font-semibold mb-4">Usage Last {days} Days</h3>

      <div className="space-y-2">
        {data.map((day) => (
          <div key={day.date} className="flex items-center gap-2">
            <div className="text-xs text-muted-foreground w-20">
              {new Date(day.date).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </div>

            <div className="flex-1 flex gap-1">
              {/* Spent bar */}
              <div
                className="bg-red-500 h-6 rounded transition-all"
                style={{ width: `${(day.spent / maxValue) * 100}%` }}
                title={`Spent: ${day.spent}`}
              />
              {/* Earned bar */}
              <div
                className="bg-green-500 h-6 rounded transition-all"
                style={{ width: `${(day.earned / maxValue) * 100}%` }}
                title={`Earned: ${day.earned}`}
              />
            </div>

            <div className="text-xs text-muted-foreground w-16 text-right tabular-nums">
              {day.spent > 0 && <div className="text-red-600">-{day.spent}</div>}
              {day.earned > 0 && <div className="text-green-600">+{day.earned}</div>}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-4 mt-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-red-500 rounded" />
          <span>Spent</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-green-500 rounded" />
          <span>Earned</span>
        </div>
      </div>
    </div>
  );
}
