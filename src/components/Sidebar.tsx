import { useMemo } from "react";
import { useStore } from "../lib/store";
import { TimerPanel } from "./TimerPanel";
import {
  IconClock,
  IconDashboard,
  IconReceipt,
  IconSettings,
  IconUsers,
} from "./icons";
import type { Route } from "../lib/routes";

const ITEMS = [
  { key: "dashboard", label: "Dashboard", Icon: IconDashboard },
  { key: "customers", label: "Kunden", Icon: IconUsers },
  { key: "time", label: "Zeiten", Icon: IconClock },
  { key: "invoices", label: "Rechnungen", Icon: IconReceipt },
] as const;

export function Sidebar({
  route,
  onNavigate,
  onStopTimer,
}: {
  route: Route;
  onNavigate: (route: Route) => void;
  onStopTimer: () => void;
}) {
  const { customers } = useStore();
  const activeCount = useMemo(() => customers.filter((c) => !c.archived).length, [customers]);

  return (
    <aside className="sidebar" data-tauri-drag-region>
      <div className="titlebar-pad" data-tauri-drag-region />
      <div className="sidebar-brand" data-tauri-drag-region>
        <IconClock className="mark" />
        Kontor
      </div>

      <nav className="nav">
        {ITEMS.map(({ key, label, Icon }) => (
          <button
            key={key}
            className="nav-item"
            aria-current={route.name === key}
            onClick={() => onNavigate({ name: key } as Route)}
          >
            <Icon />
            {label}
            {key === "customers" && activeCount > 0 ? (
              <span className="nav-count">{activeCount}</span>
            ) : null}
          </button>
        ))}

        <div className="nav-section">System</div>
        <button
          className="nav-item"
          aria-current={route.name === "settings"}
          onClick={() => onNavigate({ name: "settings" })}
        >
          <IconSettings />
          Einstellungen
        </button>
      </nav>

      <TimerPanel onStop={onStopTimer} />
    </aside>
  );
}
