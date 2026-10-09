import { Component, type ErrorInfo, type ReactNode } from "react";

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[BanglaKhata Admin] Unhandled render error", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main
          role="alert"
          className="flex min-h-screen items-center justify-center bg-slate-50 p-6"
        >
          <section className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-7 shadow-sm">
            <h1 className="text-xl font-semibold text-slate-900">
              Admin panel could not load
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              An unexpected error occurred. Reload the page to try again.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
            >
              Reload admin panel
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
