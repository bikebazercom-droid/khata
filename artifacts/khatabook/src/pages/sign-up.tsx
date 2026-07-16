import { SignUp } from '@clerk/react';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function SignUpPage() {
  return (
    <div className="min-h-[100dvh] bg-[#f8fafc] flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-[440px]">
        <SignUp
          routing="path"
          path={`${basePath}/sign-up`}
          signInUrl={`${basePath}/sign-in`}
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
              formButtonPrimary: 'bg-slate-900 hover:bg-slate-800',
              formFieldInput: 'border-slate-200 focus:border-sky-500',
            },
            variables: {
              colorPrimary: '#0f172a',
              colorForeground: '#0f172a',
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
      </div>
    </div>
  );
}
