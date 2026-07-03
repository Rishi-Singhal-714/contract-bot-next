import { NextResponse } from 'next/server';
import * as db from '@/lib/db';

export async function GET() {
  try {
    const escalations = await db.listOpenEscalations();
    return NextResponse.json(escalations);
  } catch (exc: any) {
    console.error('GET /api/escalations failed:', exc);
    return NextResponse.json({ error: exc.message || String(exc) }, { status: 500 });
  }
}
