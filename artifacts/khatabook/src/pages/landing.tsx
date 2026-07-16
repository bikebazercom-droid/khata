import { useLocation } from 'wouter';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function LandingPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="h-[100dvh] w-full bg-slate-200/60 flex justify-center overflow-hidden">
      <div className="w-full max-w-lg h-[100dvh] bg-[#f8fafc] flex flex-col relative sm:shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <img
            src={`${basePath}/logo.svg`}
            alt="ডিজিটাল খাতা"
            className="w-24 h-24 mb-6"
          />
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            ডিজিটাল খাতা
          </h1>
          <p className="text-slate-500 text-base mb-1">Digital Khata</p>
          <p className="text-slate-400 text-sm mt-3 max-w-xs leading-relaxed">
            আপনার ব্যবসার হিসাব রাখুন সহজেই — কাস্টমার, সাপ্লায়ার, বকেয়া, এবং লেনদেন এক জায়গায়।
          </p>
        </div>

        {/* Actions */}
        <div className="px-6 pb-10 space-y-3">
          <button
            onClick={() => setLocation('/sign-in')}
            className="w-full bg-slate-900 text-white rounded-xl py-3.5 text-base font-semibold hover:bg-slate-800 transition-colors"
          >
            Sign in
          </button>
          <button
            onClick={() => setLocation('/sign-up')}
            className="w-full bg-white border border-slate-200 text-slate-700 rounded-xl py-3.5 text-base font-semibold hover:bg-slate-50 transition-colors"
          >
            Create account
          </button>
          <p className="text-center text-xs text-slate-400 pt-1">
            Sign in with Google, email, or Bangladeshi phone number
          </p>
        </div>
      </div>
    </div>
  );
}
