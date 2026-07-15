import { LeftPanel } from '@/components/left-panel';
import { ReactNode } from 'react';

export function MainLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background">
      <div className="w-[35%] min-w-[340px] max-w-[480px] border-r border-slate-200 bg-white flex flex-col shadow-[2px_0_10px_-4px_rgba(0,0,0,0.1)] z-10 relative">
        <LeftPanel />
      </div>
      <div className="flex-1 bg-slate-50 flex flex-col relative z-0 h-full overflow-hidden">
        {children}
      </div>
    </div>
  );
}
