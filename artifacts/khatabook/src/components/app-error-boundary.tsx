import { Component, type ErrorInfo, type ReactNode } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[BanglaKhata] UI render error', error, info.componentStack);
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