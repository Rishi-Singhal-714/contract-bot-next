import { NextResponse } from 'next/server';
import { runReplyPoll } from '@/lib/scheduler';

export const maxDuration = 300; // 5 minutes — bounded further internally (MAX_MESSAGES_PER_RUN)
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await runReplyPoll();
    return NextResponse.json({ ok: true, ...result });
  } catch (exc: any) {
    console.error('poll-replies cron failed:', exc);
    return NextResponse.json({ ok: false, error: exc.message || String(exc) }, { status: 500 });
  }
}
