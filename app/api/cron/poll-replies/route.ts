import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { runReplyPoll } from '@/lib/scheduler';

export const maxDuration = 300; // 5 minutes — bounded further internally (MAX_MESSAGES_PER_RUN)
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  const hasSecret = config.cronSecret && authHeader === `Bearer ${config.cronSecret}`;

  if (!isVercelCron && !hasSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runReplyPoll();
    return NextResponse.json({ ok: true, ...result });
  } catch (exc: any) {
    console.error('poll-replies cron failed:', exc);
    return NextResponse.json({ ok: false, error: exc.message || String(exc) }, { status: 500 });
  }
}
