import { ReactNode } from 'react';

export function MainLayout({ children }: { children: ReactNode }) {
  return (
    <div className="h-[100dvh] w-full bg-slate-200/60 flex justify-center overflow-hidden">
      <div className="w-full max-w-lg h-[100dvh] bg-[#f8fafc] flex flex-col relative sm:shadow-2xl overflow-hidden">
        {children}
      </div>
    </div>
  );
}
