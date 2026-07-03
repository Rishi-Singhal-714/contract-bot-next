import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { runReplyPoll } from '@/lib/scheduler';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const RUN_BUDGET_MS = 4.5 * 60 * 1000;
const POLL_INTERVAL_MS = 20 * 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  const hasSecret = config.cronSecret && authHeader === `Bearer ${config.cronSecret}`;

  if (!isVercelCron && !hasSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  let iterations = 0;
  let totalFound = 0;
  let totalProcessed = 0;
  let totalFailed = 0;
  const errors: string[] = [];

  while (Date.now() - startedAt < RUN_BUDGET_MS) {
    iterations += 1;
    try {
      const result = await runReplyPoll();
      totalFound += result.found;
      totalProcessed += result.processed;
      totalFailed += result.failed;
    } catch (exc: any) {
      errors.push(exc.message || String(exc));
      console.error('poll-replies-loop iteration failed:', exc);
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed >= RUN_BUDGET_MS) break;
    await sleep(Math.min(POLL_INTERVAL_MS, RUN_BUDGET_MS - elapsed));
  }

  return NextResponse.json({
    ok: true,
    iterations,
    totalFound,
    totalProcessed,
    totalFailed,
    durationMs: Date.now() - startedAt,
    errors: errors.length ? errors : undefined,
  });
}