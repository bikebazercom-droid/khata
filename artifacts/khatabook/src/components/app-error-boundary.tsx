import { Component, type ErrorInfo, type ReactNode } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  diagnostic: string;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false, diagnostic: '' };

  static getDerivedStateFromError(error: unknown): Partial<AppErrorBoundaryState> {
    return {
      hasError: true,
      diagnostic: error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? 'Unknown error'),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[BanglaKhata] UI render error', error, info.componentStack);
    this.setState((state) => ({
      diagnostic: [state.diagnostic, info.componentStack].filter(Boolean).join('\n\n'),
    }));
  }

  private reloadApp = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main
        role="alert"
        aria-live="assertive"
        data-testid="app-error-boundary"
        style={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          background: '#f8fafc',
          color: '#0f172a',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <section
          style={{
            width: '100%',
            maxWidth: 420,
            padding: 28,
            border: '1px solid #e2e8f0',
            borderRadius: 16,
            background: '#fff',
            boxShadow: '0 12px 32px rgba(15, 23, 42, 0.08)',
          }}
        >
          <h1 style={{ margin: 0, fontSize: 22, lineHeight: 1.35 }}>অ্যাপটি খুলতে সমস্যা হয়েছে</h1>
          <p style={{ margin: '12px 0 24px', color: '#475569', lineHeight: 1.6 }}>
            আপনার হিসাবের তথ্য অক্ষত আছে। পৃষ্ঠাটি আবার লোড করে চেষ্টা করুন।
          </p>
          <details style={{ marginBottom: 20, textAlign: 'left' }}>
            <summary style={{ cursor: 'pointer', color: '#475569', fontSize: 13 }}>
              সমস্যার বিবরণ
            </summary>
            <pre
              data-testid="app-error-diagnostic"
              style={{
                maxHeight: 180,
                overflow: 'auto',
                margin: '10px 0 0',
                padding: 10,
                borderRadius: 8,
                background: '#f1f5f9',
                color: '#334155',
                fontSize: 11,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
              }}
            >
              {this.state.diagnostic || 'ত্রুটির বিবরণ পাওয়া যায়নি।'}
            </pre>
          </details>
          <button
            type="button"
            data-testid="button-reload-app"
            onClick={this.reloadApp}
            style={{
              minHeight: 44,
              width: '100%',
              border: 0,
              borderRadius: 10,
              background: '#0b3d91',
              color: '#fff',
              font: 'inherit',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            পৃষ্ঠা আবার লোড করুন
          </button>
        </section>
      </main>
    );
  }
}