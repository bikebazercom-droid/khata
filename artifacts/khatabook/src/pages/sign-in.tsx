import { useState } from 'react';
import { SignIn } from '@clerk/react';
import { sendOtp, verifyOtp } from '@/lib/phoneAuth';
import { useLocation } from 'wouter';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function SignInPage() {
  return (
    <div className="min-h-[100dvh] bg-[#f8fafc] flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-[440px] space-y-6">
        <SignInTabs />
      </div>
    </div>
  );
}

function SignInTabs() {
  const [tab, setTab] = useState<'clerk' | 'phone'>('clerk');

  return (
    <div>
      {/* Tab bar */}
      <div className="flex rounded-xl bg-slate-100 p-1 mb-6">
        <button
          onClick={() => setTab('clerk')}
          className={`flex-1 text-sm font-medium py-2 rounded-lg transition-colors ${
            tab === 'clerk'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Email / Google
        </button>
        <button
          onClick={() => setTab('phone')}
          className={`flex-1 text-sm font-medium py-2 rounded-lg transition-colors ${
            tab === 'phone'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Phone Number
        </button>
      </div>

      {tab === 'clerk' ? (
        <ClerkSignIn />
      ) : (
        <PhoneSignIn />
      )}
    </div>
  );
}

function ClerkSignIn() {
  return (
    <SignIn
      routing="path"
      path={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      appearance={{
        elements: {
          rootBox: 'w-full',
          cardBox: 'w-full rounded-2xl shadow-lg overflow-hidden border border-slate-200',
          card: '!shadow-none !border-0 !rounded-none bg-white',
          footer: '!shadow-none !border-0 !rounded-none bg-white',
          headerTitle: 'text-slate-900',
          headerSubtitle: 'text-slate-500',
          socialButtonsBlockButtonText: 'text-slate-700',
          formFieldLabel: 'text-slate-700',
          footerActionLink: 'text-sky-600',
          footerActionText: 'text-slate-500',
          dividerText: 'text-slate-400',
          formButtonPrimary: 'bg-slate-900 hover:bg-slate-800',
          formFieldInput: 'border-slate-200 focus:border-sky-500',
        },
        variables: {
          colorPrimary: '#0f172a',
          colorForeground: '#0f172a',
          colorMutedForeground: '#64748b',
          colorDanger: '#ef4444',
          colorBackground: '#ffffff',
          colorInput: '#f1f5f9',
          colorInputForeground: '#0f172a',
          colorNeutral: '#e2e8f0',
          fontFamily: 'Inter, sans-serif',
          borderRadius: '0.5rem',
        },
      }}
    />
  );
}

function PhoneSignIn() {
  const [, setLocation] = useLocation();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await sendOtp(phone);
      setStep('otp');
    } catch (err: any) {
      setError(err.message ?? 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await verifyOtp(phone, code);
      // Reload to let React Query re-fetch /api/auth/me with the new cookie.
      window.location.href = basePath || '/';
    } catch (err: any) {
      setError(err.message ?? 'Invalid code');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-8">
      <div className="flex justify-center mb-6">
        <img
          src={`${basePath}/logo.svg`}
          alt="Hazari Khatabook"
          className="w-14 h-14"
        />
      </div>

      {step === 'phone' ? (
        <>
          <h2 className="text-xl font-semibold text-slate-900 text-center mb-1">
            Sign in with phone
          </h2>
          <p className="text-sm text-slate-500 text-center mb-6">
            We'll send a 6-digit code to your number
          </p>
          <form onSubmit={handleSendOtp} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Phone number
              </label>
              <div className="flex">
                <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-slate-200 bg-slate-50 text-slate-500 text-sm">
                  🇧🇩 +88
                </span>
                <input
                  type="tel"
                  placeholder="01XXXXXXXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="flex-1 rounded-r-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                  required
                  autoFocus
                />
              </div>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-slate-900 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Sending…' : 'Send code'}
            </button>
          </form>
        </>
      ) : (
        <>
          <h2 className="text-xl font-semibold text-slate-900 text-center mb-1">
            Enter the code
          </h2>
          <p className="text-sm text-slate-500 text-center mb-6">
            Sent to {phone}
          </p>
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                6-digit code
              </label>
              <input
                type="text"
                inputMode="numeric"
                placeholder="123456"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 text-center tracking-widest text-lg bg-white focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                required
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-slate-900 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Verifying…' : 'Verify & sign in'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('phone'); setCode(''); setError(''); }}
              className="w-full text-sm text-slate-500 hover:text-slate-700 py-1"
            >
              ← Back
            </button>
          </form>
        </>
      )}

      <p className="text-center text-xs text-slate-400 mt-6">
        Don't have an account?{' '}
        <a href={`${basePath}/sign-up`} className="text-sky-600 hover:underline">
          Sign up
        </a>
      </p>
    </div>
  );
}
