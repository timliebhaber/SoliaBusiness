import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { StopTimerDialog } from "./components/TimerPanel";
import { useStore } from "./lib/store";
import { useWeeklyReport } from "./hooks/useWeeklyReport";
import type { Route } from "./lib/routes";
import { DashboardView } from "./views/Dashboard";
import { CustomersView } from "./views/Customers";
import { TimeEntriesView } from "./views/TimeEntries";
import { InvoicesView } from "./views/Invoices";
import { SettingsView } from "./views/Settings";

export function App() {
  const { ready, runningTimer, settings, stopRequested, clearStopRequest } = useStore();
  const [route, setRoute] = useState<Route>({ name: "dashboard" });
  const [stopping, setStopping] = useState(false);

  useWeeklyReport(settings);

  // Der Stopp-Wunsch kann auch aus der Menüleiste kommen.
  useEffect(() => {
    if (stopRequested > 0 && runningTimer) {
      setStopping(true);
      clearStopRequest();
    }
  }, [stopRequested, runningTimer, clearStopRequest]);

  if (!ready) {
    return (
      <div className="center-fill">
        <span className="spin" />
        Kontor wird geladen …
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar
        route={route}
        onNavigate={setRoute}
        onStopTimer={() => setStopping(true)}
      />

      <main className="content">
        {route.name === "dashboard" ? <DashboardView onNavigate={setRoute} /> : null}
        {route.name === "customers" ? (
          <CustomersView
            selectedId={route.customerId ?? null}
            onSelect={(customerId) => setRoute({ name: "customers", customerId })}
            onNavigate={setRoute}
          />
        ) : null}
        {route.name === "time" ? <TimeEntriesView customerId={route.customerId ?? null} /> : null}
        {route.name === "invoices" ? <InvoicesView onNavigate={setRoute} /> : null}
        {route.name === "settings" ? <SettingsView /> : null}
      </main>

      {stopping && runningTimer ? <StopTimerDialog onClose={() => setStopping(false)} /> : null}
    </div>
  );
}
