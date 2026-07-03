import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { runExpiryScan } from '@/lib/scheduler';

export const maxDuration = 300; // 5 minutes — Vercel Pro plan required for this ceiling
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Vercel signs cron requests with this header automatically; as a second
  // layer, also accept a manually-set CRON_SECRET as a bearer token so you
  // can trigger this by hand (e.g. `curl -H "Authorization: Bearer $CRON_SECRET" ...`).
  const authHeader = req.headers.get('authorization');
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  const hasSecret = config.cronSecret && authHeader === `Bearer ${config.cronSecret}`;

  if (!isVercelCron && !hasSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runExpiryScan();
    return NextResponse.json({ ok: true, ...result });
  } catch (exc: any) {
    console.error('expiry-scan cron failed:', exc);
    return NextResponse.json({ ok: false, error: exc.message || String(exc) }, { status: 500 });
  }
}
