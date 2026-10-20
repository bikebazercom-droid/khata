import type { ReactNode } from 'react';
import type { AuthConnectivity } from '@/lib/useAuthConnectivity';
import { isPublicAuthRoute } from '@/lib/auth-route-policy';

type AuthConnectivityGateProps = {
  path: string;
  phase: AuthConnectivity;
  hasOfflineIdentity: boolean;
  onRetry: () => void;
  children: ReactNode;
};

export function AuthConnectivityGate({
  path,
  phase,
  hasOfflineIdentity,
  onRetry,
  children,
}: AuthConnectivityGateProps) {
  if (phase === 'offline' && !hasOfflineIdentity && !isPublicAuthRoute(path)) {
    return <OnlineConnectionRequired onRetry={onRetry} />;
  }

  return <>{children}</>;
}

function OnlineConnectionRequired({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="min-h-[100dvh] bg-slate-50 px-6 flex items-center justify-center">
      <section className="w-full max-w-sm rounded-2xl bg-white p-7 text-center shadow-sm border border-slate-100">
        <h1 className="text-xl font-bold text-slate-900">সার্ভারের সাথে সংযোগ নেই</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          ব্রাউজারে হিসাব দেখতে বা যোগ করতে সক্রিয় ইন্টারনেট সংযোগ দরকার। সংযোগ ফিরে এলে আবার চেষ্টা করুন।
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 min-h-11 w-full rounded-xl bg-[#0b3d91] px-4 font-semibold text-white hover:bg-blue-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          আবার চেষ্টা করুন
        </button>
      </section>
    </main>
  );
}
