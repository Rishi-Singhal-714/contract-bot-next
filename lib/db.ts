import { getPool } from './mysql';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

export type Contract = {
  id: number;
  client_name: string;
  client_email: string;
  contract_link: string | null;
  template_path: string | null;
  expiry_date: string;
  status: string;
  signature_status: string;
  match_status: string;
  ai_managed: number; // MySQL TINYINT(1): 0 or 1
  created_at: string;
  updated_at: string;
};

export type ConversationMessage = {
  id: number;
  contract_id: number;
  direction: 'inbound' | 'outbound';
  sender: string;
  subject: string | null;
  body: string | null;
  timestamp: string;
};

export type Escalation = {
  id: number;
  contract_id: number;
  reason: string;
  ai_summary: string | null;
  status: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_notes: string | null;
};

// MySQL DATETIME wants a space, not the "T" from toISOString().
function now(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// ---------- Contracts ----------

export async function createContract(input: {
  client_name: string;
  client_email: string;
  contract_link?: string | null;
  expiry_date: string;
  template_path?: string | null;
}): Promise<number> {
  const pool = getPool();
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO contracts
       (client_name, client_email, contract_link, template_path, expiry_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.client_name,
      input.client_email,
      input.contract_link || null,
      input.template_path || null,
      input.expiry_date,
      now(),
      now(),
    ]
  );
  return result.insertId;
}

export async function getContract(contractId: number): Promise<Contract | null> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM contracts WHERE id = ?', [contractId]);
  return (rows[0] as Contract) || null;
}

/** Best-effort match of an inbound reply to a contract by sender address. */
export async function getContractByEmail(clientEmail: string): Promise<Contract | null> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM contracts WHERE client_email = ? ORDER BY updated_at DESC LIMIT 1',
    [clientEmail]
  );
  return (rows[0] as Contract) || null;
}

export async function listContracts(status?: string): Promise<Contract[]> {
  const pool = getPool();
  if (status) {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM contracts WHERE status = ? ORDER BY expiry_date',
      [status]
    );
    return rows as Contract[];
  }
  const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM contracts ORDER BY expiry_date');
  return rows as Contract[];
}

/**
 * All distinct client emails we have a contract for. Used to filter the
 * inbox at the IMAP level so unrelated mail (newsletters, other services,
 * etc.) is never even fetched/parsed — instead of downloading everything
 * and discarding it after the fact.
 */
export async function listClientEmails(): Promise<string[]> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT DISTINCT client_email FROM contracts WHERE client_email IS NOT NULL'
  );
  return (rows as { client_email: string }[]).map((r) => r.client_email).filter(Boolean);
}

/**
 * (id, client_email) pairs for every contract. Used to cross-check that an
 * inbound reply's `[CB-<id>]` subject tag actually belongs to the contract
 * for that sender address — not just any known client email.
 */
export async function listContractEmailIds(): Promise<{ id: number; client_email: string }[]> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, client_email FROM contracts WHERE client_email IS NOT NULL'
  );
  return rows as { id: number; client_email: string }[];
}

export async function listExpiringContracts(withinDays: number): Promise<Contract[]> {
  const today = new Date();
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + withinDays);
  const todayStr = today.toISOString().slice(0, 10);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM contracts
     WHERE expiry_date BETWEEN ? AND ?
     AND status NOT IN ('renewed', 'cancelled')`,
    [todayStr, cutoffStr]
  );
  return rows as Contract[];
}

export async function updateContract(contractId: number, fields: Record<string, any>) {
  if (!fields || Object.keys(fields).length === 0) return;
  const withTimestamp = { ...fields, updated_at: now() };
  const columns = Object.keys(withTimestamp)
    .map((k) => `${k} = ?`)
    .join(', ');
  const values = [...Object.values(withTimestamp), contractId];

  const pool = getPool();
  await pool.query(`UPDATE contracts SET ${columns} WHERE id = ?`, values);
}

export async function setAiManaged(contractId: number, managed: boolean) {
  await updateContract(contractId, { ai_managed: managed ? 1 : 0 });
}

// ---------- Conversations ----------

export async function logMessage(
  contractId: number,
  direction: 'inbound' | 'outbound',
  sender: string,
  subject: string | null,
  body: string | null
) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO conversations (contract_id, direction, sender, subject, body, timestamp)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [contractId, direction, sender, subject, body, now()]
  );
}

export async function getConversation(contractId: number): Promise<ConversationMessage[]> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM conversations WHERE contract_id = ? ORDER BY timestamp',
    [contractId]
  );
  return rows as ConversationMessage[];
}

// ---------- Escalations ----------

export async function createEscalation(contractId: number, reason: string, aiSummary?: string | null) {
  const pool = getPool();
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO escalations (contract_id, reason, ai_summary, created_at) VALUES (?, ?, ?, ?)`,
    [contractId, reason, aiSummary || null, now()]
  );
  return result.insertId;
}

export async function listOpenEscalations(): Promise<
  (Escalation & Pick<Contract, 'client_name' | 'client_email' | 'expiry_date'>)[]
> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT escalations.*, contracts.client_name, contracts.client_email, contracts.expiry_date
     FROM escalations
     JOIN contracts ON contracts.id = escalations.contract_id
     WHERE escalations.status = 'open'
     ORDER BY escalations.created_at`
  );
  return rows as any;
}

export async function getEscalation(escalationId: number): Promise<Escalation | null> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM escalations WHERE id = ?', [escalationId]);
  return (rows[0] as Escalation) || null;
}

export async function resolveEscalation(escalationId: number, resolvedBy: string, notes = '') {
  const pool = getPool();
  await pool.query(
    `UPDATE escalations
     SET status = 'resolved', resolved_at = ?, resolved_by = ?, resolution_notes = ?
     WHERE id = ?`,
    [now(), resolvedBy, notes, escalationId]
  );
}

// ---------- IMAP cursor (new — needed for serverless polling) ----------

export async function getImapCursor(mailbox: string): Promise<number> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>('SELECT last_uid FROM imap_cursor WHERE mailbox = ?', [mailbox]);
  return rows[0]?.last_uid ?? 0;
}

export async function setImapCursor(mailbox: string, lastUid: number) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO imap_cursor (mailbox, last_uid, updated_at) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE last_uid = VALUES(last_uid), updated_at = VALUES(updated_at)`,
    [mailbox, lastUid, now()]
  );
}
