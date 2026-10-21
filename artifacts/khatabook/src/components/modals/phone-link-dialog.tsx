import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { sendPhoneLinkOtp, verifyPhoneLinkOtp } from '@/lib/phoneAuth';

export function PhoneLinkDialog({
  open,
  onOpenChange,
  currentPhone,
  lang,
  onLinked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPhone?: string;
  lang: 'bn' | 'en';
  onLinked: (phone: string) => void;
}) {
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const en = lang === 'en';

  const close = (next: boolean) => {
    if (!next && loading) return;
    if (!next) {
      setStep('phone');
      setPhone('');
      setCode('');
      setError('');
    }
    onOpenChange(next);
  };

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await sendPhoneLinkOtp(phone);
      setStep('code');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : (en ? 'Could not send code.' : 'কোড পাঠানো যায়নি।'));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await verifyPhoneLinkOtp(phone, code);
      onLinked(result.phone);
      setLoading(false);
      close(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : (en ? 'Could not verify code.' : 'কোড যাচাই করা যায়নি।'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle>{en ? 'Link a phone to this account' : 'এই account-এ ফোন নম্বর যুক্ত করুন'}</DialogTitle>
          <DialogDescription>
            {currentPhone
              ? (en ? `Current linked phone: ${currentPhone}` : `বর্তমান যুক্ত নম্বর: ${currentPhone}`)
              : (en ? 'Your existing account and ledgers will stay unchanged.' : 'আপনার আগের account ও খাতাগুলো একই থাকবে।')}
          </DialogDescription>
        </DialogHeader>
        {step === 'phone' ? (
          <form onSubmit={handleSend} className="space-y-4">
            <label className="block text-sm font-medium text-slate-700" htmlFor="phone-link-number">
              {en ? 'Bangladesh mobile number' : 'বাংলাদেশি মোবাইল নম্বর'}
            </label>
            <div className="flex">
              <span className="flex items-center rounded-l-lg border border-r-0 bg-slate-50 px-3 text-sm text-slate-500">+88</span>
              <input
                id="phone-link-number"
                data-testid="input-phone-link-number"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                maxLength={11}
                required
                value={phone}
                onChange={(event) => setPhone(event.target.value.replace(/[^0-9০-৯]/g, '').slice(0, 11))}
                placeholder="01XXXXXXXXX"
                className="min-h-11 min-w-0 flex-1 rounded-r-lg border px-3 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
              />
            </div>
            {error && <p role="alert" data-testid="status-phone-link-error" className="text-sm text-red-600">{error}</p>}
            <button type="submit" data-testid="button-phone-link-send" disabled={loading} className="min-h-11 w-full rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-50">
              {loading ? (en ? 'Sending…' : 'পাঠানো হচ্ছে…') : (en ? 'Send verification code' : 'যাচাই কোড পাঠান')}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="space-y-4">
            <p className="text-sm text-slate-600">
              {en ? `Enter the 6-digit code sent to ${phone}.` : `${phone} নম্বরে পাঠানো ৬ সংখ্যার কোড লিখুন।`}
            </p>
            <input
              data-testid="input-phone-link-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              value={code}
              onChange={(event) => setCode(event.target.value
                .replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6))
                .replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              className="min-h-11 w-full rounded-lg border px-3 text-center text-lg tracking-widest outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
            />
            {error && <p role="alert" data-testid="status-phone-link-error" className="text-sm text-red-600">{error}</p>}
            <button type="submit" data-testid="button-phone-link-verify" disabled={loading || code.length !== 6} className="min-h-11 w-full rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-50">
              {loading ? (en ? 'Verifying…' : 'যাচাই হচ্ছে…') : (en ? 'Verify and link phone' : 'যাচাই করে নম্বর যুক্ত করুন')}
            </button>
            <button
              type="button"
              data-testid="button-phone-link-back"
              disabled={loading}
              onClick={() => { setStep('phone'); setCode(''); setError(''); }}
              className="min-h-10 w-full text-sm text-slate-600"
            >
              {en ? 'Use a different number' : 'অন্য নম্বর ব্যবহার করুন'}
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
