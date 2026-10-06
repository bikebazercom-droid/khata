import { PublicPageShell } from "@/components/layout/public-page-shell";

export function SupportPage() {
  return (
    <PublicPageShell
      title="Support | BanglaKhata - Business Ledger"
      description="Get help with BanglaKhata sign-in, customer and supplier records, ledger entries, reports, and offline syncing."
    >
      <article lang="en" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-sky-700">BanglaKhata help</p>
        <h1 className="mb-3 text-3xl font-bold tracking-tight text-[#1B3A6B]">Support</h1>
        <p className="mb-8 max-w-2xl text-base leading-7 text-slate-600">
          Contact us for help with your account, customers and suppliers, ledger entries, reports, or syncing.
        </p>

        <section className="rounded-2xl bg-blue-50 p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-slate-900">Email our support team</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Describe what happened and the phone or browser you are using. Please do not send passwords, one-time codes, or full customer financial records.
          </p>
          <a
            href="mailto:support@banglakhata.com?subject=BanglaKhata%20support"
            data-testid="link-support-email"
            className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#1B3A6B] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#24488A]"
          >
            support@banglakhata.com
          </a>
        </section>

        <section className="mt-8 border-t border-slate-200 pt-6">
          <h2 className="text-lg font-semibold text-slate-900">What to include</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600">
            <li>The phone number or email associated with your BanglaKhata account.</li>
            <li>Your device model and operating system, or browser name and version.</li>
            <li>A short description of the issue and the steps that led to it.</li>
          </ul>
        </section>

        <p className="mt-8 text-sm text-slate-600">
          For privacy, access, correction, or deletion requests, use the same email and write “Privacy request” in the subject.
        </p>
      </article>
    </PublicPageShell>
  );
}
