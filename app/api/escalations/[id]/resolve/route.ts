import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import * as aiEngine from '@/lib/aiEngine';
import { sendEmail } from '@/lib/emailClient';
import { config } from '@/lib/config';
import { withContractTag } from '@/lib/contractTag';

export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const escalationId = Number(params.id);
  const body = await req.json().catch(() => ({}));
  const notes = body.notes || '';
  const resolvedBy = body.resolved_by || config.employeeEmails[0] || 'employee';

  const escalation = await db.getEscalation(escalationId);
  let message = 'Escalation resolved';

  if (escalation && escalation.reason === 'ready_for_confirmation') {
    const contract = await db.getContract(escalation.contract_id);
    if (contract) {
      const confirmationBody = await aiEngine.draftRenewalConfirmationEmail(
        contract.client_name,
        contract.expiry_date
      );
      await sendEmail(
        contract.client_email,
        withContractTag('Your contract has been renewed', contract.id),
        confirmationBody
      );
      await db.logMessage(
        contract.id,
        'outbound',
        config.emailAddress,
        withContractTag('Your contract has been renewed', contract.id),
        confirmationBody
      );
      await db.updateContract(contract.id, { status: 'renewed' });
      message = 'Renewal confirmed — client has been notified';
    }
  }

  await db.resolveEscalation(escalationId, resolvedBy, notes);
  return NextResponse.json({ ok: true, message });
}
