'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Contract = {
  id: number;
  client_name: string;
  client_email: string;
  expiry_date: string;
  status: string;
  signature_status: string;
  match_status: string;
  ai_managed: boolean;
};

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[] | null>(null);

  useEffect(() => {
    fetch('/api/contracts')
      .then((r) => r.json())
      .then(setContracts);
  }, []);

  if (!contracts) return <p>Loading…</p>;

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Contracts</h1>
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="p-3">Client</th>
              <th className="p-3">Expiry</th>
              <th className="p-3">Status</th>
              <th className="p-3">Signature</th>
              <th className="p-3">AI managed</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.id} className="border-t hover:bg-gray-50">
                <td className="p-3">
                  <Link href={`/contract/${c.id}`} className="hover:underline">
                    {c.client_name}
                  </Link>
                  <div className="text-gray-500 text-xs">{c.client_email}</div>
                </td>
                <td className="p-3">{c.expiry_date}</td>
                <td className="p-3">{c.status}</td>
                <td className="p-3">{c.signature_status}</td>
                <td className="p-3">{c.ai_managed ? 'Yes' : 'No — human managed'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
