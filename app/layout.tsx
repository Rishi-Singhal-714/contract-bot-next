import './globals.css';
import Link from 'next/link';

export const metadata = {
  title: 'Contract Renewal Bot',
  description: 'Escalation queue, conversations, and contract oversight',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="bg-white border-b px-6 py-3 flex items-center gap-6">
          <span className="font-semibold">Contract Renewal Bot</span>
          <Link href="/" className="text-sm text-gray-600 hover:text-black">
            Escalations
          </Link>
          <Link href="/contracts" className="text-sm text-gray-600 hover:text-black">
            Contracts
          </Link>
          <Link href="/contracts/new" className="text-sm text-gray-600 hover:text-black">
            + New contract
          </Link>
        </nav>
        <main className="max-w-5xl mx-auto p-6">{children}</main>
      </body>
    </html>
  );
}
