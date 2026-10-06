import { useState } from 'react';
import { SignIn } from '@clerk/react';
import { sendOtp, verifyOtp } from '@/lib/phoneAuth';
import { authMeQueryKey } from '@/lib/authQueryKeys';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { PageMeta } from '@/components/layout/page-meta';
import { SiteFooter } from '@/components/layout/site-footer';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function SignInPage() {
  return (
    <>
      <PageMeta
        title="Sign In | BanglaKhata - Business Ledger"
        description="Sign in to BanglaKhata with Email, Google, or a phone verification code to access your business ledger."
      />
      <div className="sign-in-page h-[100dvh] overflow-y-auto overscroll-y-contain bg-gradient-to-b from-[#1B3A6B] to-[#2a5298] flex flex-col items-center justify-center px-4 py-12">
        {/* Brand logo */}
        <div className="sign-in-brand mb-8 flex flex-col items-center gap-4">
          <img
            src={`${basePath}/logo-icon.svg`}
            alt="Banglakhata"
            className="w-24 h-24 drop-shadow-xl"
          />
          <div className="text-center">
            <p className="text-white font-extrabold text-3xl tracking-tight leading-tight">Banglakhata</p>
          </div>
        </div>
        <div className="w-full max-w-[440px]">
          <SignInTabs />
        </div>
        <SiteFooter tone="dark" />
      </div>
    </>
  );
}

function SignInTabs() {
  const [tab, setTab] = useState<'clerk' | 'phone'>('clerk');

  return (
    <div>
      {/* Tab bar */}
      <div className="sign-in-tab-bar flex rounded-xl bg-white/20 p-1 mb-6">
        <button
          onClick={() => setTab('clerk')}
          className={`flex-1 text-sm font-medium py-2 rounded-lg transition-colors ${
            tab === 'clerk'
              ? 'bg-white text-[#1B3A6B] shadow-sm font-bold'
              : 'text-white/80 hover:text-white'
          }`}
        >
          Email / Google
        </button>
        <button
          onClick={() => setTab('phone')}
          className={`flex-1 text-sm font-medium py-2 rounded-lg transition-colors ${
            tab === 'phone'
              ? 'bg-white text-[#1B3A6B] shadow-sm font-bold'
              : 'text-white/80 hover:text-white'
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
          formButtonPrimary: 'bg-[#1B3A6B] hover:bg-[#24488A]',
          formFieldInput: 'border-slate-200 focus:border-[#1B3A6B]',
        },
        variables: {
          colorPrimary: '#1B3A6B',
          colorForeground: '#1B3A6B',
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

export function PhoneSignIn() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
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
      const me = await verifyOtp(phone, code);
      // Seed React Query's auth-me cache with the fresh response so
      // useAppAuth resolves immediately — no hard reload needed.
      qc.setQueryData(authMeQueryKey(), me);
      setLocation('/');
    } catch (err: any) {
      setError(err.message ?? 'Invalid code');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="phone-sign-in-card bg-white rounded-2xl shadow-lg border border-slate-200 p-8">

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
                  data-testid="input-phone"
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
              data-testid="button-send-otp"
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
                data-testid="input-otp-code"
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
              data-testid="button-verify-otp"
              disabled={loading}
              className="w-full bg-slate-900 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Verifying…' : 'Verify & sign in'}
            </button>
            <button
              type="button"
              data-testid="button-back-to-phone"
              onClick={() => { setStep('phone'); setCode(''); setError(''); }}
              className="w-full text-sm text-slate-500 hover:text-slate-700 py-1"
            >
              ← Back
            </button>
          </form>
        </>
      )}

      <p className="phone-sign-in-footer text-center text-xs text-slate-400 mt-6">
        Don't have an account?{' '}
        <a href={`${basePath}/sign-up`} className="text-sky-600 hover:underline">
          Sign up
        </a>
      </p>
    </div>
  );
}
