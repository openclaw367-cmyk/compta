import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { usePreferences } from '../../context/preferencesStore';

export function AppShell({ children }: { children: ReactNode }) {
  const { sidebarCollapsed } = usePreferences();
  return (
    <div className="flex h-screen bg-bg text-ink">
      {!sidebarCollapsed && <Sidebar />}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
