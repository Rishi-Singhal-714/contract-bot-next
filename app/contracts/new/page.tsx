'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NewContractPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    client_name: '',
    client_email: '',
    contract_link: '',
    expiry_date: '',
    template_path: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create contract');
      }
      router.push('/contracts');
    } catch (exc: any) {
      setError(exc.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-semibold mb-4">New contract</h1>
      <form onSubmit={submit} className="bg-white border rounded-lg p-5 grid gap-4">
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <Field label="Client name" value={form.client_name} onChange={(v) => setForm({ ...form, client_name: v })} required />
        <Field
          label="Client email"
          type="email"
          value={form.client_email}
          onChange={(v) => setForm({ ...form, client_email: v })}
          required
        />
        <Field
          label="Contract link"
          value={form.contract_link}
          onChange={(v) => setForm({ ...form, contract_link: v })}
        />
        <Field
          label="Expiry date"
          type="date"
          value={form.expiry_date}
          onChange={(v) => setForm({ ...form, expiry_date: v })}
          required
        />
        <Field
          label="Template storage path (Supabase templates bucket)"
          value={form.template_path}
          onChange={(v) => setForm({ ...form, template_path: v })}
          placeholder="e.g. sample_contract_company_a.pdf"
        />
        <button
          type="submit"
          disabled={saving}
          className="justify-self-start px-4 py-2 rounded bg-black text-white text-sm disabled:opacity-50"
        >
          {saving ? 'Creating…' : 'Create contract'}
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-gray-600">{label}</span>
      <input
        className="border rounded px-3 py-2"
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
