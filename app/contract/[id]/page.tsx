'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

type Contract = {
  id: number;
  client_name: string;
  client_email: string;
  contract_link: string | null;
  template_path: string | null;
  expiry_date: string;
  status: string;
  signature_status: string;
  match_status: string;
  ai_managed: boolean;
};

type Message = {
  id: number;
  direction: 'inbound' | 'outbound';
  sender: string;
  subject: string | null;
  body: string | null;
  timestamp: string;
};

export default function ContractDetailPage() {
  const params = useParams<{ id: string }>();
  const [contract, setContract] = useState<Contract | null>(null);
  const [conversation, setConversation] = useState<Message[]>([]);
  const [form, setForm] = useState<Partial<Contract>>({});
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);

  async function load() {
    const res = await fetch(`/api/contracts/${params.id}`);
    const data = await res.json();
    setContract(data.contract);
    setConversation(data.conversation || []);
    setForm(data.contract || {});
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function saveEdits(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await fetch(`/api/contracts/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function toggleAi() {
    setToggling(true);
    try {
      await fetch(`/api/contracts/${params.id}/toggle-ai`, { method: 'POST' });
      await load();
    } finally {
      setToggling(false);
    }
  }

  if (!contract) return <p>Loading…</p>;

  return (
    <div className="grid gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{contract.client_name}</h1>
          <p className="text-gray-500 text-sm">{contract.client_email}</p>
        </div>
        <button
          onClick={toggleAi}
          disabled={toggling}
          className={`text-sm px-3 py-1.5 rounded border ${
            contract.ai_managed ? 'bg-green-50 text-green-800 border-green-200' : 'bg-gray-100 text-gray-700'
          }`}
        >
          {toggling ? 'Updating…' : contract.ai_managed ? 'AI managed — click to take over' : 'Human managed — click to re-enable AI'}
        </button>
      </div>

      <section className="bg-white border rounded-lg p-5">
        <h2 className="font-medium mb-3">Contract details</h2>
        <form onSubmit={saveEdits} className="grid grid-cols-2 gap-4 text-sm">
          <EditField label="Client name" value={form.client_name} onChange={(v) => setForm({ ...form, client_name: v })} />
          <EditField label="Client email" value={form.client_email} onChange={(v) => setForm({ ...form, client_email: v })} />
          <EditField label="Contract link" value={form.contract_link || ''} onChange={(v) => setForm({ ...form, contract_link: v })} />
          <EditField label="Template path" value={form.template_path || ''} onChange={(v) => setForm({ ...form, template_path: v })} />
          <EditField label="Expiry date" type="date" value={form.expiry_date} onChange={(v) => setForm({ ...form, expiry_date: v })} />
          <EditField label="Status" value={form.status} onChange={(v) => setForm({ ...form, status: v })} />
          <EditField label="Signature status" value={form.signature_status} onChange={(v) => setForm({ ...form, signature_status: v })} />
          <div className="col-span-2 text-gray-500">Match status: {contract.match_status}</div>
          <button
            type="submit"
            disabled={saving}
            className="col-span-2 justify-self-start px-4 py-2 rounded bg-black text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      </section>

      <section className="bg-white border rounded-lg p-5">
        <h2 className="font-medium mb-3">Conversation</h2>
        {conversation.length === 0 && <p className="text-gray-500 text-sm">No messages yet.</p>}
        <div className="grid gap-3">
          {conversation.map((m) => (
            <div
              key={m.id}
              className={`p-3 rounded border text-sm ${
                m.direction === 'inbound' ? 'bg-gray-50' : 'bg-blue-50 border-blue-100'
              }`}
            >
              <div className="text-xs text-gray-500 mb-1">
                {m.direction.toUpperCase()} — {m.sender} — {m.timestamp}
              </div>
              <div className="whitespace-pre-wrap">{m.body}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-gray-600">{label}</span>
      <input
        className="border rounded px-3 py-2"
        type={type}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
