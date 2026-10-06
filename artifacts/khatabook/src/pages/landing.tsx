import { SiteFooter } from "@/components/layout/site-footer";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function LandingPage() {
  return (
    <div className="min-h-[100dvh] w-full bg-gradient-to-b from-[#0f2444] via-[#1B3A6B] to-[#2a5298] flex flex-col items-center">
      <nav className="w-full max-w-5xl flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <img src={`${basePath}/logo-icon.svg`} alt="BanglaKhata" className="w-8 h-8" />
          <span className="text-white font-bold text-lg tracking-tight">BanglaKhata</span>
        </div>
      </nav>

      <main className="flex-1 flex flex-col items-center justify-center text-center px-6 py-16 max-w-2xl">
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
          গ্রাহক, সরবরাহকারী, বকেয়া এবং লেনদেন — সব এক জায়গায়।
        </p>

        <a
          href={`${basePath}/sign-in`}
          data-testid="link-landing-sign-in"
          className="w-full max-w-sm flex items-center justify-center gap-3 bg-[#0078d4] hover:bg-[#006cbf] border border-[#0078d4]/50 text-white rounded-2xl px-6 py-4 font-bold text-sm shadow-xl transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
        >
          Sign In / সাইন ইন করুন
        </a>

        <p className="text-white/30 text-xs mt-6">
          বিনামূল্যে · কোনো ক্রেডিট কার্ড লাগবে না
        </p>
      </main>

      <div className="w-full max-w-5xl grid grid-cols-1 sm:grid-cols-3 gap-4 px-6 pb-16">
        {[
          { title: "লেনদেনের হিসাব", desc: "যা দিলেন, যা পেলেন — সব রেকর্ড রাখুন" },
          { title: "পার্টি ম্যানেজমেন্ট", desc: "গ্রাহক ও সরবরাহকারীর তালিকা সহজে পরিচালনা করুন" },
          { title: "পেমেন্ট রিমাইন্ডার", desc: "বকেয়া পেলে অটো SMS রিমাইন্ডার পাঠান" },
        ].map((feature) => (
          <div key={feature.title} className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <h3 className="text-white font-semibold text-sm mb-1.5">{feature.title}</h3>
            <p className="text-white/50 text-xs leading-relaxed">{feature.desc}</p>
          </div>
        ))}
      </div>

      <SiteFooter tone="dark" />
    </div>
  );
}