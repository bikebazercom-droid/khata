import { Link } from 'wouter';
import { PageMeta } from '@/components/layout/page-meta';
import { SiteFooter } from '@/components/layout/site-footer';

export function SignUpPage() {
  return (
    <>
      <PageMeta
        title="Create an Account | BanglaKhata"
        description="Start using BanglaKhata with your approved Google account."
      />
      <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-[#f8fafc] px-4 py-12">
        <section className="w-full max-w-[440px] rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-lg">
          <h1 className="text-xl font-semibold text-slate-900">Create your BanglaKhata account</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Sign in with Google using an email approved for your business. Your existing ledger
            access will be linked to the same verified email.
          </p>
          <Link
            href="/sign-in"
            className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-[#1B3A6B] px-4 py-3 text-sm font-semibold text-white hover:bg-[#24488A]"
          >
            Continue to sign in
          </Link>
        </section>
        <SiteFooter />
      </main>
    </>
  );
}
