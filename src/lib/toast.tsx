import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toKontorError } from "./api";

type Tone = "info" | "success" | "error";

interface Toast {
  id: number;
  tone: Tone;
  title: string;
  detail?: string;
}

interface ToastApi {
  info: (title: string, detail?: string) => void;
  success: (title: string, detail?: string) => void;
  /** Nimmt einen beliebigen Fehler entgegen und macht daraus eine lesbare Meldung. */
  error: (error: unknown, context?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast außerhalb des ToastProvider verwendet");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (tone: Tone, title: string, detail?: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-4), { id, tone, title, detail }]);
      // Fehler bleiben länger stehen — sie müssen gelesen werden können.
      window.setTimeout(() => dismiss(id), tone === "error" ? 9000 : 4200);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      info: (title, detail) => push("info", title, detail),
      success: (title, detail) => push("success", title, detail),
      error: (error, context) => {
        const err = toKontorError(error);
        push("error", context ?? "Das hat nicht geklappt", err.message);
      },
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone}`}>
            <span className="accent-bar" />
            <div style={{ minWidth: 0 }}>
              <div className="title">{toast.title}</div>
              {toast.detail ? <div>{toast.detail}</div> : null}
            </div>
            <button className="close" onClick={() => dismiss(toast.id)} aria-label="Schließen">
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
