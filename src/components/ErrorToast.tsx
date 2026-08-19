import { useEffect, useState } from "react";
import { useVaultStore } from "../store/vaultStore";

const LEAVE_MS = 160;

export function ErrorToast() {
  const error = useVaultStore((s) => s.error);
  const clearError = useVaultStore((s) => s.clearError);
  const [message, setMessage] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (error) {
      setMessage(error);
      setLeaving(false);
      return;
    }
    if (!message) return;
    setLeaving(true);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timeout = window.setTimeout(
      () => {
        setMessage(null);
        setLeaving(false);
      },
      reduce ? 0 : LEAVE_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [error, message]);

  if (!message) return null;

  return (
    <div className="error-toast-layer">
      <div className={`error-toast${leaving ? " is-leaving" : ""}`} role="alert">
        <span className="error-toast-text">{message}</span>
        <button
          type="button"
          className="error-toast-dismiss"
          aria-label="Dismiss"
          onClick={() => clearError()}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
