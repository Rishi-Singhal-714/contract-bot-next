import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  const contract = await db.getContract(id);
  if (!contract) return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
  await db.setAiManaged(id, !contract.ai_managed);
  return NextResponse.json({ ok: true, ai_managed: !contract.ai_managed });
}
