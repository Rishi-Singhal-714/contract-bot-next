import { NextResponse } from 'next/server';
import { runExpiryScan } from '@/lib/scheduler';

export const maxDuration = 300; // 5 minutes — Vercel Pro plan required for this ceiling
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await runExpiryScan();
    return NextResponse.json({ ok: true, ...result });
  } catch (exc: any) {
    console.error('expiry-scan cron failed:', exc);
    return NextResponse.json({ ok: false, error: exc.message || String(exc) }, { status: 500 });
  }
}
