/**
 * POST /api/webhooks/clerk
 *
 * Clerk webhook handler for user lifecycle events
 * Initializes credits for new users
 *
 * Required environment variable:
 * - CLERK_WEBHOOK_SECRET
 *
 * Setup:
 * 1. Go to Clerk Dashboard > Webhooks
 * 2. Add endpoint: https://your-app.com/api/webhooks/clerk
 * 3. Subscribe to: user.created
 * 4. Copy signing secret to CLERK_WEBHOOK_SECRET
 */

import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { Webhook } from 'svix';
import { credits } from '@/lib/credits';

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    console.error('Missing CLERK_WEBHOOK_SECRET environment variable');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  // Get headers
  const headerPayload = await headers();
  const svix_id = headerPayload.get('svix-id');
  const svix_timestamp = headerPayload.get('svix-timestamp');
  const svix_signature = headerPayload.get('svix-signature');

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return NextResponse.json({ error: 'Missing svix headers' }, { status: 400 });
  }

  // Get body
  const payload = await req.json();
  const body = JSON.stringify(payload);

  // Verify webhook signature
  const wh = new Webhook(WEBHOOK_SECRET);
  let evt: any;

  try {
    evt = wh.verify(body, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    });
  } catch (err) {
    console.error('Webhook verification failed:', err);
    return NextResponse.json({ error: 'Webhook verification failed' }, { status: 400 });
  }

  // Handle user.created event
  if (evt.type === 'user.created') {
    const { id, email_addresses } = evt.data;

    try {
      const result = await credits.initializeUser(id, 100);
      console.log(`✓ Initialized credits for user ${id} (${email_addresses[0]?.email_address})`);
      console.log(`  Balance: ${result.balance}, TX: ${result.txId}`);
    } catch (error) {
      console.error(`✗ Failed to initialize credits for user ${id}:`, error);
      // Don't return error - we don't want Clerk to retry
    }
  }

  return NextResponse.json({ received: true });
}
