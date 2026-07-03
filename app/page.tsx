'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type EscalationRow = {
  id: number;
  contract_id: number;
  reason: string;
  ai_summary: string | null;
  created_at: string;
  client_name: string;
  client_email: string;
  expiry_date: string;
};

export default function EscalationQueuePage() {
  const [escalations, setEscalations] = useState<EscalationRow[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function load() {
    const res = await fetch('/api/escalations');
    setEscalations(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function resolve(id: number) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/escalations/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved_by: 'employee' }),
      });
      const data = await res.json();
      alert(data.message || 'Resolved');
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (!escalations) return <p>Loading…</p>;

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Open escalations</h1>
      {escalations.length === 0 && <p className="text-gray-500">Nothing needs your attention right now.</p>}
      <div className="grid gap-4">
        {escalations.map((e) => (
          <div key={e.id} className="bg-white rounded-lg border p-4 shadow-sm">
            <div className="flex justify-between items-start">
              <div>
                <Link href={`/contract/${e.contract_id}`} className="font-medium hover:underline">
                  {e.client_name}
                </Link>{' '}
                <span className="text-gray-500 text-sm">({e.client_email})</span>
                <div className="text-sm text-gray-500">Expiry: {e.expiry_date}</div>
              </div>
              <span className="text-xs uppercase tracking-wide bg-amber-100 text-amber-800 px-2 py-1 rounded">
                {e.reason.replace(/_/g, ' ')}
              </span>
            </div>
            {e.ai_summary && <p className="mt-3 text-sm text-gray-700 whitespace-pre-wrap">{e.ai_summary}</p>}
            <div className="mt-3 flex gap-2">
              <Link
                href={`/contract/${e.contract_id}`}
                className="text-sm px-3 py-1.5 rounded border hover:bg-gray-50"
              >
                Open contract
              </Link>
              <button
                onClick={() => resolve(e.id)}
                disabled={busyId === e.id}
                className="text-sm px-3 py-1.5 rounded bg-black text-white disabled:opacity-50"
              >
                {busyId === e.id ? 'Resolving…' : 'Mark resolved'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
