import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { useToast } from "../lib/toast";
import {
  formatCents,
  formatDuration,
  formatWeekday,
  formatDate,
} from "../lib/format";
import type { Dashboard } from "../lib/types";
import type { Route } from "../lib/routes";
import { Badge, Button, EmptyState, Notice } from "../components/ui";
import { IconInbox } from "../components/icons";

function Stat({
  label,
  value,
  foot,
  tone,
}: {
  label: string;
  value: string;
  foot?: string;
  tone?: "accent" | "warn" | "danger";
}) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {foot ? <div className="foot">{foot}</div> : null}
    </div>
  );
}

function DayChart({ data }: { data: Dashboard["last14Days"] }) {
  const max = Math.max(60, ...data.map((d) => d.minutes));
  return (
    <div className="chart">
      {data.map((day) => {
        const height = day.minutes === 0 ? 2 : Math.max(4, (day.minutes / max) * 88);
        return (
          <div className="chart-col" key={day.date} title={`${formatDate(day.date)}: ${formatDuration(day.minutes)}`}>
            <div
              className={`chart-bar ${day.minutes === 0 ? "zero" : ""}`}
              style={{ height }}
            />
            <span className="chart-label">{formatWeekday(day.date)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function DashboardView({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const { version } = useStore();
  const toast = useToast();
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .dashboard()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((error) => toast.error(error, "Dashboard konnte nicht geladen werden"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [version, toast]);

  return (
    <>
      <header className="content-header" data-tauri-drag-region>
        <div>
          <h1>Dashboard</h1>
          <div className="sub">Überblick über Zeit, offene Aufgaben und Außenstände</div>
        </div>
      </header>

      <div className="scroll-area">
        {loading && !data ? (
          <div className="center-fill">
            <span className="spin" />
          </div>
        ) : !data ? (
          <EmptyState icon={<IconInbox />} title="Keine Daten verfügbar" />
        ) : (
          <div className="stack" style={{ gap: 20 }}>
            <div className="stat-grid">
              <Stat label="Heute" value={formatDuration(data.todayMinutes)} />
              <Stat label="Diese Woche" value={formatDuration(data.weekMinutes)} />
              <Stat label="Dieser Monat" value={formatDuration(data.monthMinutes)} />
              <Stat
                label="Unabgerechnet"
                value={formatCents(data.unbilledCents)}
                foot={formatDuration(data.unbilledMinutes)}
                tone="accent"
              />
            </div>

            {data.unbilledMinutesWithoutRate > 0 ? (
              <Notice tone="warn">
                {formatDuration(data.unbilledMinutesWithoutRate)} unabgerechnete Zeit entfallen auf
                Kunden ohne hinterlegten Stundensatz und fehlen deshalb im Betrag oben.
              </Notice>
            ) : null}

            <div className="card">
              <div className="card-title">Letzte 14 Tage</div>
              <DayChart data={data.last14Days} />
            </div>

            <div className="grid-2" style={{ alignItems: "start" }}>
              <div className="card">
                <div className="card-title">Überfällige Aufgaben</div>
                {data.overdue.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                    Nichts überfällig — sauber.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {data.overdue.slice(0, 8).map((task) => (
                      <button
                        key={task.id}
                        className="row"
                        style={{
                          background: "transparent",
                          border: 0,
                          padding: 0,
                          textAlign: "left",
                          width: "100%",
                        }}
                        onClick={() =>
                          onNavigate({ name: "customers", customerId: task.customerId })
                        }
                      >
                        <div className="grow" style={{ minWidth: 0 }}>
                          <div className="truncate" style={{ fontWeight: 500 }}>
                            {task.title}
                          </div>
                          <div className="secondary" style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                            {task.customerName} · fällig {formatDate(task.deadline)}
                          </div>
                        </div>
                        <Badge tone="danger">
                          {task.daysOverdue} {task.daysOverdue === 1 ? "Tag" : "Tage"}
                        </Badge>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="card">
                <div className="card-title">Unabgerechnet je Kunde</div>
                {data.byCustomerUnbilled.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                    Alles abgerechnet.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {data.byCustomerUnbilled.slice(0, 8).map((bucket) => {
                      const share =
                        data.unbilledMinutes > 0
                          ? (bucket.minutes / data.unbilledMinutes) * 100
                          : 0;
                      return (
                        <div key={bucket.customerId}>
                          <div className="row" style={{ marginBottom: 4 }}>
                            <span className="truncate" style={{ fontWeight: 500 }}>
                              {bucket.customerName}
                            </span>
                            <span className="spacer" />
                            <span className="numeric" style={{ fontSize: 12 }}>
                              {formatDuration(bucket.minutes)}
                            </span>
                            <span
                              className="numeric"
                              style={{ fontSize: 12, minWidth: 76, color: "var(--text-secondary)" }}
                            >
                              {bucket.cents > 0 ? formatCents(bucket.cents) : "kein Satz"}
                            </span>
                          </div>
                          <div className="meter">
                            <span style={{ width: `${share}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="row">
              <Button onClick={() => onNavigate({ name: "customers" })}>
                Zu den Kunden
              </Button>
              <Button onClick={() => onNavigate({ name: "time" })}>Zeiten ansehen</Button>
              <span className="spacer" />
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {data.activeCustomers} aktive Kunden · {data.openTasks} offene Aufgaben
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
