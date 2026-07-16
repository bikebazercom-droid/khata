import { ReactNode } from 'react';
import { useConnectionState } from '@/context/connection-state';

export function MainLayout({ children }: { children: ReactNode }) {
  const { isOnline } = useConnectionState();

  return (
    <div className="h-[100dvh] w-full bg-slate-200/60 flex justify-center overflow-hidden">
      <div className="w-full max-w-lg h-[100dvh] bg-[#f8fafc] flex flex-col relative sm:shadow-2xl overflow-hidden">
        {/* Offline badge — appears at the very top when SSE connection is lost */}
        {!isOnline && (
          <div className="flex items-center justify-center py-1 bg-amber-50 border-b border-amber-200">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Offline
            </span>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
