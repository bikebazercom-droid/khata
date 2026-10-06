import type { ReactNode } from "react";
import { PageMeta } from "./page-meta";
import { SiteFooter } from "./site-footer";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

type PublicPageShellProps = {
  title: string;
  description: string;
  children: ReactNode;
};

export function PublicPageShell({ title, description, children }: PublicPageShellProps) {
  return (
    <>
      <PageMeta title={title} description={description} />
      <div className="flex min-h-[100dvh] flex-col bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-5 py-4">
            <a
              href={`${basePath}/`}
              data-testid="link-public-home-brand"
              className="flex items-center gap-2.5"
            >
              <img
                src={`${basePath}/logo-icon.svg`}
                alt="BanglaKhata"
                width={32}
                height={32}
                className="h-8 w-8"
              />
              <span className="font-bold tracking-tight text-[#1B3A6B]">BanglaKhata</span>
            </a>
            <a
              href={`${basePath}/`}
              data-testid="link-public-home"
              className="text-sm font-medium text-slate-600 transition-colors hover:text-[#1B3A6B]"
            >
              Back to home
            </a>
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8 sm:py-12">
          {children}
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
