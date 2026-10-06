type SiteFooterProps = {
  tone?: "light" | "dark";
};

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function SiteFooter({ tone = "light" }: SiteFooterProps) {
  const isDark = tone === "dark";

  return (
    <footer
      className={`w-full border-t px-6 py-5 ${
        isDark ? "border-white/10 text-white/55" : "border-slate-200 bg-white text-slate-500"
      }`}
    >
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 sm:flex-row sm:justify-between">
        <nav aria-label="Privacy and support" className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-medium">
          <a
            href={`${basePath}/privacy-policy`}
            data-testid="link-privacy-policy"
            className={`transition-colors ${isDark ? "hover:text-white" : "hover:text-[#1B3A6B]"}`}
          >
            Privacy Policy
          </a>
          <a
            href={`${basePath}/support`}
            data-testid="link-support"
            className={`transition-colors ${isDark ? "hover:text-white" : "hover:text-[#1B3A6B]"}`}
          >
            Support
          </a>
        </nav>
        <p className="text-center text-xs">© 2026 Banglakhata. All rights reserved.</p>
      </div>
    </footer>
  );
}
