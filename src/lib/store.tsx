import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api";
import { useToast } from "./toast";
import type { AppSettings, CustomerSummary, RunningTimer } from "./types";

interface Store {
  customers: CustomerSummary[];
  runningTimer: RunningTimer | null;
  settings: AppSettings | null;
  ready: boolean;
  /** Zähler, an den Ansichten ihre eigenen Ladevorgänge hängen. */
  version: number;
  refresh: () => void;
  reloadSettings: () => Promise<void>;
  stopRequested: number;
  clearStopRequest: () => void;
}

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore außerhalb des StoreProvider verwendet");
  return ctx;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [runningTimer, setRunningTimer] = useState<RunningTimer | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const [stopRequested, setStopRequested] = useState(0);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const reloadSettings = useCallback(async () => {
    try {
      setSettings(await api.getSettings());
    } catch (error) {
      toast.error(error, "Einstellungen konnten nicht geladen werden");
    }
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [list, timer, config] = await Promise.all([
          api.listCustomers(true, null),
          api.getRunningTimer(),
          api.getSettings(),
        ]);
        if (cancelled) return;
        setCustomers(list);
        setRunningTimer(timer);
        setSettings(config);
      } catch (error) {
        if (!cancelled) toast.error(error, "Daten konnten nicht geladen werden");
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version, toast]);

  // Der laufende Timer kann auch aus der Menüleiste geändert werden.
  useEffect(() => {
    const unlisten = Promise.all([
      listen("timer-changed", () => {
        api
          .getRunningTimer()
          .then(setRunningTimer)
          .catch((error) => toast.error(error, "Timer-Status unklar"));
        refresh();
      }),
      listen("request-stop-timer", () => setStopRequested((n) => n + 1)),
      listen<string>("tray-error", (event) => toast.error(event.payload, "Menüleiste")),
    ]);
    return () => {
      unlisten.then((fns) => fns.forEach((fn) => fn()));
    };
  }, [refresh, toast]);

  const value = useMemo<Store>(
    () => ({
      customers,
      runningTimer,
      settings,
      ready,
      version,
      refresh,
      reloadSettings,
      stopRequested,
      clearStopRequest: () => setStopRequested(0),
    }),
    [customers, runningTimer, settings, ready, version, refresh, reloadSettings, stopRequested],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
