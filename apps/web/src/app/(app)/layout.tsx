'use client';

import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { CopilotPanel } from '@/components/copilot/copilot-panel';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [copilot, setCopilot] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCopilot((v) => !v);
      }
      if (e.key === 'Escape') setCopilot(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onCopilot={() => setCopilot(true)} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
      <CopilotPanel open={copilot} onClose={() => setCopilot(false)} />
    </div>
  );
}
