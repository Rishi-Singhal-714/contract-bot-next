import { NextResponse } from 'next/server';
import { runReplyPoll } from '@/lib/scheduler';

// Hobby plans can't schedule a Vercel Cron more often than once/day, so this
// route is meant to be hit by an EXTERNAL scheduler (cron-job.org, GitHub
// Actions, UptimeRobot, EasyCron, etc.) instead of vercel.json's `crons`.
// Each hit keeps polling in a loop for ~4.5 minutes before returning, so a
// trigger every 5 minutes gives near-continuous coverage without ever
// exceeding one invocation per call.
//
// NOTE: maxDuration of 300s requires either a Pro plan, or a Hobby project
// with Fluid Compute enabled. If your account caps functions at 60s, lower
// RUN_BUDGET_MS below (e.g. to 50_000) so the function returns before Vercel
// kills it.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const RUN_BUDGET_MS = 4.5 * 60 * 1000; // leave headroom under the 300s hard limit
const POLL_INTERVAL_MS = 20 * 1000; // gap between polls inside one invocation

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET() {
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
