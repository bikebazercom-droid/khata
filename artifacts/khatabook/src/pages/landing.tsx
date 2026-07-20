const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function LandingPage() {
  return (
    <div className="min-h-[100dvh] w-full bg-gradient-to-b from-[#0f2444] via-[#1B3A6B] to-[#2a5298] flex flex-col items-center">

      {/* Nav */}
      <nav className="w-full max-w-5xl flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <img src={`${basePath}/logo-icon.svg`} alt="BanglaKhata" className="w-8 h-8" />
          <span className="text-white font-bold text-lg tracking-tight">BanglaKhata</span>
        </div>
        <a
          href={`${basePath}/sign-in`}
          className="text-white/70 text-sm hover:text-white transition-colors font-medium"
        >
          সাইন ইন করুন →
        </a>
      </nav>

      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-16 max-w-2xl">
        <img
          src={`${basePath}/logo-icon.svg`}
          alt="BanglaKhata"
          className="w-24 h-24 mb-8 drop-shadow-2xl"
        />
        <h1 className="text-5xl font-extrabold text-white leading-tight mb-5 tracking-tight">
          বাংলা খাতা
        </h1>
        <p className="text-white/70 text-lg leading-relaxed mb-3 max-w-md">
          আপনার ব্যবসার হিসাব রাখুন সহজেই
        </p>
        <p className="text-white/50 text-sm max-w-sm leading-relaxed mb-12">
          কাস্টমার, সাপ্লায়ার, বকেয়া এবং লেনদেন — সব এক জায়গায়।
          Android ও iOS-এ বিনামূল্যে পাওয়া যাচ্ছে।
        </p>

        {/* Download buttons */}
        <div className="flex flex-col sm:flex-row gap-4 w-full max-w-sm">
          <a
            href="#"
            className="flex-1 flex items-center justify-center gap-3 bg-white text-[#1B3A6B] rounded-2xl px-6 py-4 font-bold text-sm shadow-xl hover:bg-white/90 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3.18 23.76a2 2 0 0 0 2.73.74l10.47-6.03-2.91-2.91-10.29 8.2zM20.8 10.34L6.18.92A2 2 0 0 0 3.18.18L13.86 10.86 20.8 10.34zM2.01 1.5A2 2 0 0 0 2 2v20a2 2 0 0 0 .01.5L13.14 11.36 2.01 1.5zM16.54 13l-2.68-2.68 2.68-2.68 3.05 1.76a2 2 0 0 1 0 3.46L16.54 13z"/>
            </svg>
            <span>Play Store<br/><span className="font-normal text-xs opacity-70">Android-এ ডাউনলোড</span></span>
          </a>
          <a
            href="#"
            className="flex-1 flex items-center justify-center gap-3 bg-white/10 border border-white/20 text-white rounded-2xl px-6 py-4 font-bold text-sm hover:bg-white/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
            </svg>
            <span>App Store<br/><span className="font-normal text-xs opacity-70">iOS-এ ডাউনলোড</span></span>
          </a>
        </div>

        <p className="text-white/30 text-xs mt-6">
          বিনামূল্যে · কোনো ক্রেডিট কার্ড লাগবে না
        </p>
      </div>

      {/* Feature strip */}
      <div className="w-full max-w-5xl grid grid-cols-1 sm:grid-cols-3 gap-4 px-6 pb-16">
        {[
          { title: "লেনদেনের হিসাব", desc: "যা দিলেন, যা পেলেন — সব রেকর্ড রাখুন" },
          { title: "পার্টি ম্যানেজমেন্ট", desc: "কাস্টমার ও সাপ্লায়ারের তালিকা সহজে পরিচালনা করুন" },
          { title: "পেমেন্ট রিমাইন্ডার", desc: "বকেয়া পেলে অটো SMS রিমাইন্ডার পাঠান" },
        ].map((f) => (
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
  );
}
