import { useEffect, useState } from 'react';
import { sendOtp, verifyOtp, fetchMe } from '@/lib/phoneAuth';
import { authMeQueryKey } from '@/lib/authQueryKeys';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { PageMeta } from '@/components/layout/page-meta';
import { SiteFooter } from '@/components/layout/site-footer';
import {
  beginGoogleSignIn,
  exchangeFirebaseSession,
  finishGoogleRedirect,
} from '@/lib/firebaseClient';

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
  const [tab, setTab] = useState<'google' | 'phone'>('google');

  return (
    <div>
      {/* Tab bar */}
      <div className="sign-in-tab-bar flex rounded-xl bg-white/20 p-1 mb-6">
        <button
          onClick={() => setTab('google')}
          className={`flex-1 text-sm font-medium py-2 rounded-lg transition-colors ${
            tab === 'google'
              ? 'bg-white text-[#1B3A6B] shadow-sm font-bold'
              : 'text-white/80 hover:text-white'
          }`}
        >
          Google
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

      {tab === 'google' ? (
        <GoogleSignIn />
      ) : (
        <PhoneSignIn />
      )}
    </div>
  );
}

function GoogleSignIn() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function completeSignIn(credential: Awaited<ReturnType<typeof finishGoogleRedirect>>) {
    if (!credential) return;
    await exchangeFirebaseSession(credential);
    const me = await fetchMe();
    queryClient.setQueryData(authMeQueryKey(), me);
    setLocation(me.role === 'owner' ? '/dashboard' : '/');
  }

  useEffect(() => {
    let active = true;
    finishGoogleRedirect()
      .then(async (credential) => {
        if (!credential || !active) return;
        setLoading(true);
        await completeSignIn(credential);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Google sign-in failed.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function handleGoogleSignIn() {
    setError('');
    setLoading(true);
    try {
      const credential = await beginGoogleSignIn();
      if (credential) await completeSignIn(credential);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
      <h2 className="text-center text-xl font-semibold text-slate-900">Welcome back</h2>
      <p className="mb-6 mt-1 text-center text-sm text-slate-500">Sign in to your ledger account</p>
      {error && <p role="alert" className="mb-4 text-sm text-red-600">{error}</p>}
      <button
        type="button"
        onClick={() => void handleGoogleSignIn()}
        disabled={loading}
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
      >
        <span aria-hidden="true" className="text-base font-bold text-[#4285f4]">G</span>
        {loading ? 'Signing in…' : 'Continue with Google'}
      </button>
    </div>
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
      setLocation(me.role === 'owner' ? '/dashboard' : '/');
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
            Sent to {phone}. The code is valid for 15 minutes.
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
                onChange={(e) => setCode(e.target.value
                  .replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6))
                  .replace(/\D/g, '')
                  .slice(0, 6))}
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
