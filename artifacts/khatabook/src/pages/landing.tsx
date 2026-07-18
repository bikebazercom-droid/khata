import { useLocation } from 'wouter';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function LandingPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="h-[100dvh] w-full bg-slate-200/60 flex justify-center overflow-hidden">
      <div className="w-full max-w-lg h-[100dvh] bg-white flex flex-col relative sm:shadow-2xl overflow-hidden">
        {/* Hero — dark navy brand gradient */}
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center bg-gradient-to-b from-[#1B3A6B] to-[#2a5298]">
          <img
            src={`${basePath}/logo-icon.svg`}
            alt="Banglakhata"
            className="w-28 h-28 mb-6 drop-shadow-xl"
          />
          <h1 className="text-4xl font-extrabold text-white mb-4 tracking-tight">
            Banglakhata
          </h1>
          <p className="text-white/60 text-sm max-w-xs leading-relaxed">
            আপনার ব্যবসার হিসাব রাখুন সহজেই — কাস্টমার, সাপ্লায়ার, বকেয়া, এবং লেনদেন এক জায়গায়।
          </p>
        </div>

        {/* Actions */}
        <div className="px-6 py-8 space-y-3 bg-white border-t border-slate-100">
          <button
            onClick={() => setLocation('/sign-in')}
            className="w-full bg-[#1B3A6B] text-white rounded-xl py-3.5 text-base font-bold hover:bg-[#24488A] transition-colors"
          >
            Sign in
          </button>
          <button
            onClick={() => setLocation('/sign-up')}
            className="w-full bg-white border-2 border-[#1B3A6B] text-[#1B3A6B] rounded-xl py-3.5 text-base font-bold hover:bg-blue-50 transition-colors"
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
