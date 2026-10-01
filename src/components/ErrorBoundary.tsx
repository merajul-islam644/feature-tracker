import { Component, type ErrorInfo, type ReactNode } from "react";

// Global crash guard. Without this, one thrown render error anywhere in
// the tree unmounts the whole app to a blank page — in a verification
// tool that can be mid-run, that means losing sight of a live run for a
// UI glitch. The boundary keeps the shell alive, states plainly that
// something broke, and offers a no-states-lost recovery path (reload).
// Deliberately class-based: function components can't catch render
// errors, and React's own docs still prescribe this exact shape.
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface in the console for diagnosis — the boundary itself stays
    // silent to the user beyond the fallback card. No telemetry sink is
    // wired up, and inventing one here would be speculative.
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-foreground">
            Something went wrong
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The interface hit an unexpected error. Your data is safe —
            reloading the page restores the workspace. Any verification run
            keeps running locally even while this screen is shown.
          </p>
          <p className="mt-3 break-words rounded-md bg-muted p-2 font-mono text-xs text-muted-foreground">
            {this.state.error.message || "Unknown error"}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}
