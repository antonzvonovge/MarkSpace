import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };

type State = {
  error: Error | null;
  componentStack: string;
};

/**
 * Without a boundary any render throw unmounts the whole root and leaves a
 * blank window, which hides the actual stack in packaged builds.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("MarkSpace crashed during render", error, info);
    this.setState({ componentStack: info.componentStack ?? "" });
  }

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="app-crash">
        <h1 className="app-crash-title">MarkSpace hit an unexpected error</h1>
        <p className="app-crash-message">{error.message || String(error)}</p>
        <div className="app-crash-actions">
          <button
            type="button"
            className="app-crash-button"
            onClick={() => this.setState({ error: null, componentStack: "" })}
          >
            Try again
          </button>
          <button
            type="button"
            className="app-crash-button"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
          <button
            type="button"
            className="app-crash-button"
            onClick={() => {
              void navigator.clipboard.writeText(
                `${error.stack ?? error.message}\n\nComponent stack:${componentStack}`,
              );
            }}
          >
            Copy details
          </button>
        </div>
        <pre className="app-crash-stack">
          {error.stack ?? error.message}
          {componentStack ? `\n\nComponent stack:${componentStack}` : ""}
        </pre>
      </div>
    );
  }
}
