import { Component } from 'react';

/**
 * Root error boundary.
 *
 * Without this, any render-time throw unmounts the whole tree and the browser
 * shows a blank page with nothing to go on. This keeps the failure visible and
 * offers the two things that actually help: the message, and a way back.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Logging a crash is the whole point of an error boundary, so this is the
    // one place the console is the right destination.
    // eslint-disable-next-line no-console
    console.error('Unhandled UI error:', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-lg rounded-xl border border-rose-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-800">Something broke while rendering</h1>
          <p className="mt-1 text-sm text-slate-500">
            The rest of the app is fine; this screen failed. Reloading usually clears it.
          </p>

          <pre className="mt-4 max-h-40 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-rose-700">
            {error.message || String(error)}
          </pre>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
}
