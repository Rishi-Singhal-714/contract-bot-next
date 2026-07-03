import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';

export async function GET() {
  const contracts = await db.listContracts();
  return NextResponse.json(contracts);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { client_name, client_email, contract_link, expiry_date, template_path } = body;

  if (!client_name || !client_email || !expiry_date) {
    return NextResponse.json({ error: 'client_name, client_email, and expiry_date are required' }, { status: 400 });
  }

  const id = await db.createContract({
    client_name,
    client_email,
    contract_link: contract_link || null,
    expiry_date,
    template_path: template_path || null,
  });

  return NextResponse.json({ id }, { status: 201 });
}
