import { useState, useEffect } from 'react';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

// ── Types ─────────────────────────────────────────────────────────────────────

interface DownloadConfig {
  androidStoreUrl: string | null;
  androidApkUrl:   string | null;
  apkAvailable:    boolean;
  iosStoreUrl:     string | null;
  windowsAvailable: boolean;
  windowsUrl:      string | null;
}

// ── iOS modal ─────────────────────────────────────────────────────────────────

function IosModal({ onClose, storeUrl }: { onClose: () => void; storeUrl: string | null }) {
  const qrTarget = storeUrl ?? window.location.origin;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&color=1B3A6B&bgcolor=ffffff&data=${encodeURIComponent(qrTarget)}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl max-w-sm w-full p-8 text-center relative"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors"
          aria-label="Close"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>

        <div className="flex justify-center mb-5">
          <div className="w-16 h-16 bg-[#1B3A6B]/5 rounded-2xl flex items-center justify-center">
            <svg className="w-9 h-9 text-[#1B3A6B]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
            </svg>
          </div>
        </div>

        {storeUrl ? (
          <>
            <h3 className="text-lg font-bold text-slate-800 mb-1">Download on App Store</h3>
            <p className="text-slate-500 text-sm mb-6">iPhone দিয়ে নিচের QR কোড স্ক্যান করুন অথবা বাটনটি চাপুন।</p>
            <div className="flex justify-center mb-6">
              <img src={qrSrc} alt="App Store QR" className="w-44 h-44 rounded-xl border border-slate-100 shadow-sm" />
            </div>
            <a href={storeUrl} target="_blank" rel="noopener noreferrer"
              className="block w-full bg-[#1B3A6B] text-white rounded-xl py-3 font-semibold text-sm hover:bg-[#24488A] transition-colors">
              App Store-এ যান →
            </a>
          </>
        ) : (
          <>
            <h3 className="text-lg font-bold text-slate-800 mb-1">iOS — শীঘ্রই আসছে</h3>
            <p className="text-slate-500 text-sm mb-6">
              iOS অ্যাপটি App Store-এ আসার পথে আছে।
              তখন পর্যন্ত নিচের QR কোড স্ক্যান করে আমাদের ওয়েবসাইটটি বুকমার্ক করে রাখুন।
            </p>
            <div className="flex justify-center mb-6">
              <img src={qrSrc} alt="Website QR" className="w-44 h-44 rounded-xl border border-slate-100 shadow-sm" />
            </div>
            <span className="inline-block bg-amber-50 text-amber-700 border border-amber-200 text-xs font-semibold px-4 py-2 rounded-full">
              🔔 TestFlight বেটা শীঘ্রই পাওয়া যাবে
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// ── "Coming soon" toast ───────────────────────────────────────────────────────

function ComingSoonToast({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-white text-[#1B3A6B] rounded-2xl shadow-2xl px-6 py-4 flex items-center gap-3 text-sm font-semibold animate-in slide-in-from-bottom-4 duration-300">
      <span className="text-lg">🚀</span>
      Play Store লিস্টিং শীঘ্রই আসছে — APK প্রস্তুত করা হচ্ছে!
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function LandingPage() {
  const [cfg, setCfg]                   = useState<DownloadConfig | null>(null);
  const [showIosModal, setShowIosModal] = useState(false);
  const [showAndroidToast, setShowAndroidToast] = useState(false);

  useEffect(() => {
    // Use the new DB-backed endpoint; fall back to an empty config on error
    fetch(`${basePath}/api/public/download-configs`)
      .then(r => r.json())
      .then(setCfg)
      .catch(() => setCfg({
        androidStoreUrl:  null,
        androidApkUrl:    null,
        apkAvailable:     false,
        iosStoreUrl:      null,
        windowsAvailable: false,
        windowsUrl:       null,
      }));
  }, []);

  // ── click handlers ──────────────────────────────────────────────────────────

  function handleAndroidClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (!cfg) return;

    if (cfg.androidStoreUrl) {
      window.open(cfg.androidStoreUrl, '_blank', 'noopener,noreferrer');
    } else if (cfg.apkAvailable && cfg.androidApkUrl) {
      const a = document.createElement('a');
      a.href = cfg.androidApkUrl;
      a.download = 'banglakhata.apk';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      setShowAndroidToast(true);
    }
  }

  function handleIosClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (!cfg) return;

    if (cfg.iosStoreUrl) {
      window.open(cfg.iosStoreUrl, '_blank', 'noopener,noreferrer');
    } else {
      setShowIosModal(true);
    }
  }

  function handleWindowsClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (!cfg?.windowsUrl) return;

    const a = document.createElement('a');
    a.href = cfg.windowsUrl;
    a.download = 'banglakhata-windows.exe';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ── derived labels ──────────────────────────────────────────────────────────

  const androidLabel = cfg?.androidStoreUrl ? 'Play Store'
                     : cfg?.apkAvailable     ? 'Download APK'
                     : 'Play Store';
  const androidSub   = cfg?.androidStoreUrl ? 'Android-এ ডাউনলোড'
                     : cfg?.apkAvailable     ? 'সরাসরি ডাউনলোড'
                     : 'শীঘ্রই আসছে';
  const iosLabel     = cfg?.iosStoreUrl ? 'App Store' : 'App Store';
  const iosSub       = cfg?.iosStoreUrl ? 'iOS-এ ডাউনলোড' : 'শীঘ্রই আসছে';

  return (
    <>
      {showIosModal && (
        <IosModal onClose={() => setShowIosModal(false)} storeUrl={cfg?.iosStoreUrl ?? null} />
      )}
      {showAndroidToast && (
        <ComingSoonToast onClose={() => setShowAndroidToast(false)} />
      )}

      <div className="min-h-[100dvh] w-full bg-gradient-to-b from-[#0f2444] via-[#1B3A6B] to-[#2a5298] flex flex-col items-center">

        {/* Nav */}
        <nav className="w-full max-w-5xl flex items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2.5">
            <img src={`${basePath}/logo-icon.svg`} alt="BanglaKhata" className="w-8 h-8" />
            <span className="text-white font-bold text-lg tracking-tight">BanglaKhata</span>
          </div>
          <a href={`${basePath}/sign-in`}
            className="text-white/70 text-sm hover:text-white transition-colors font-medium">
            সাইন ইন করুন →
          </a>
        </nav>

        {/* Hero */}
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-16 max-w-2xl">
          <img src={`${basePath}/logo-icon.svg`} alt="BanglaKhata"
            className="w-24 h-24 mb-8 drop-shadow-2xl" />

          <h1 className="text-5xl font-extrabold text-white leading-tight mb-5 tracking-tight">
            বাংলা খাতা
          </h1>
          <p className="text-white/70 text-lg leading-relaxed mb-3 max-w-md">
            আপনার ব্যবসার হিসাব রাখুন সহজেই
          </p>
          <p className="text-white/50 text-sm max-w-sm leading-relaxed mb-12">
            গ্রাহক, সরবরাহকারী, বকেয়া এবং লেনদেন — সব এক জায়গায়।
            Android, iOS ও Windows-এ বিনামূল্যে পাওয়া যাচ্ছে।
          </p>

          {/* Android + iOS row */}
          <div className="flex flex-col sm:flex-row gap-4 w-full max-w-sm mb-4">

            {/* Android */}
            <a href="#" onClick={handleAndroidClick}
              className="flex-1 flex items-center justify-center gap-3 bg-white text-[#1B3A6B] rounded-2xl px-6 py-4 font-bold text-sm shadow-xl hover:bg-white/90 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer">
              <svg className="w-6 h-6 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3.18 23.76a2 2 0 0 0 2.73.74l10.47-6.03-2.91-2.91-10.29 8.2zM20.8 10.34L6.18.92A2 2 0 0 0 3.18.18L13.86 10.86 20.8 10.34zM2.01 1.5A2 2 0 0 0 2 2v20a2 2 0 0 0 .01.5L13.14 11.36 2.01 1.5zM16.54 13l-2.68-2.68 2.68-2.68 3.05 1.76a2 2 0 0 1 0 3.46L16.54 13z"/>
              </svg>
              <span>
                {androidLabel}
                <br/>
                <span className="font-normal text-xs opacity-70">{androidSub}</span>
              </span>
            </a>

            {/* iOS */}
            <a href="#" onClick={handleIosClick}
              className="flex-1 flex items-center justify-center gap-3 bg-white/10 border border-white/20 text-white rounded-2xl px-6 py-4 font-bold text-sm hover:bg-white/20 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer">
              <svg className="w-6 h-6 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
              </svg>
              <span>
                {iosLabel}
                <br/>
                <span className="font-normal text-xs opacity-70">{iosSub}</span>
              </span>
            </a>
          </div>

          {/* Windows button — only shown when available */}
          {cfg?.windowsAvailable && (
            <a href="#" onClick={handleWindowsClick}
              className="w-full max-w-sm flex items-center justify-center gap-3 bg-[#0078d4] hover:bg-[#006cbf] border border-[#0078d4]/50 text-white rounded-2xl px-6 py-4 font-bold text-sm shadow-xl transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer">
              <svg className="w-6 h-6 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-13.051-1.949"/>
              </svg>
              <span>
                Windows App / কম্পিউটার ভার্সন
                <br/>
                <span className="font-normal text-xs opacity-80">কম্পিউটারের জন্য ডাউনলোড করুন</span>
              </span>
            </a>
          )}

          <p className="text-white/30 text-xs mt-6">
            বিনামূল্যে · কোনো ক্রেডিট কার্ড লাগবে না
          </p>
        </div>

        {/* Feature strip */}
        <div className="w-full max-w-5xl grid grid-cols-1 sm:grid-cols-3 gap-4 px-6 pb-16">
          {[
            { title: "লেনদেনের হিসাব",    desc: "যা দিলেন, যা পেলেন — সব রেকর্ড রাখুন" },
            { title: "পার্টি ম্যানেজমেন্ট", desc: "গ্রাহক ও সরবরাহকারীর তালিকা সহজে পরিচালনা করুন" },
            { title: "পেমেন্ট রিমাইন্ডার", desc: "বকেয়া পেলে অটো SMS রিমাইন্ডার পাঠান" },
          ].map(f => (
            <div key={f.title} className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <h3 className="text-white font-semibold text-sm mb-1.5">{f.title}</h3>
              <p className="text-white/50 text-xs leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <footer className="w-full border-t border-white/10 py-5 px-6 text-center">
          <p className="text-white/30 text-xs">© ২০২৬ BanglaKhata · সব অধিকার সংরক্ষিত</p>
        </footer>
      </div>
    </>
  );
}
