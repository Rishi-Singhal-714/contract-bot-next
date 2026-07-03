import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';

const EDITABLE_FIELDS = [
  'client_name',
  'client_email',
  'contract_link',
  'template_path',
  'expiry_date',
  'status',
  'signature_status',
] as const;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const contract = await db.getContract(Number(params.id));
  if (!contract) return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
  const conversation = await db.getConversation(Number(params.id));
  return NextResponse.json({ contract, conversation });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const fields: Record<string, any> = {};
  for (const key of EDITABLE_FIELDS) {
    if (body[key] !== undefined && body[key] !== '') fields[key] = body[key];
  }
  await db.updateContract(Number(params.id), fields);
  return NextResponse.json({ ok: true });
}
