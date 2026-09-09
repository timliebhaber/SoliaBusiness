import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { useToast } from "../lib/toast";
import { formatCents, formatDuration } from "../lib/format";
import type { CustomerSummary, TimeEntry } from "../lib/types";
import type { Route } from "../lib/routes";
import { Badge, Button, ConfirmDialog } from "../components/ui";
import { IconArchive, IconPencil, IconPlay, IconPlus, IconTrash } from "../components/icons";
import { TaskList } from "../components/TaskList";
import { TimeEntryFormDialog, TimeEntryTable } from "../components/TimeEntryTable";
import { InvoicePanel } from "../components/InvoicePanel";
import { StartTimerDialog } from "../components/TimerPanel";
import { CustomerFormDialog } from "./Customers";

type Tab = "tasks" | "time" | "billing";

export function CustomerDetail({
  summary,
  onNavigate,
}: {
  summary: CustomerSummary;
  onNavigate: (route: Route) => void;
}) {
  const { refresh, runningTimer, version } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("tasks");
  const [editing, setEditing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [addingTime, setAddingTime] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);

  const loadEntries = useCallback(() => {
    setLoadingEntries(true);
    api
      .listTimeEntries({ customerId: summary.id, limit: 300 })
      .then(setEntries)
      .catch((error) => toast.error(error, "Zeiten konnten nicht geladen werden"))
      .finally(() => setLoadingEntries(false));
  }, [summary.id, toast]);

  useEffect(() => {
    if (tab === "time") loadEntries();
  }, [tab, loadEntries, version]);

  async function setArchived(archived: boolean) {
    try {
      await api.setCustomerArchived(summary.id, archived);
      refresh();
      setConfirmArchive(false);
    } catch (error) {
      toast.error(error, "Archivieren nicht möglich");
    }
  }

  async function remove() {
    try {
      await api.deleteCustomer(summary.id);
      refresh();
      setConfirmDelete(false);
      onNavigate({ name: "customers" });
    } catch (error) {
      toast.error(error, "Löschen nicht möglich");
      setConfirmDelete(false);
    }
  }

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "18px 22px 0" }}>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 18, fontWeight: 640, letterSpacing: "-0.02em" }}>
              {summary.name}
              {summary.archived ? (
                <span style={{ marginLeft: 8 }}>
                  <Badge tone="neutral">Archiviert</Badge>
                </span>
              ) : null}
            </h2>
            <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 2 }}>
              {[summary.company, summary.email].filter(Boolean).join(" · ") || "Keine weiteren Angaben"}
            </div>
          </div>
          <span className="spacer" />
          <div className="row">
            {!summary.archived && !runningTimer ? (
              <Button variant="running" onClick={() => setStarting(true)}>
                <IconPlay /> Timer
              </Button>
            ) : null}
            <Button onClick={() => setEditing(true)} title="Bearbeiten">
              <IconPencil />
            </Button>
            <Button
              onClick={() =>
                summary.archived ? void setArchived(false) : setConfirmArchive(true)
              }
              title={summary.archived ? "Reaktivieren" : "Archivieren"}
            >
              <IconArchive />
            </Button>
            {summary.openTasks === 0 && summary.trackedMinutesTotal === 0 ? (
              <Button variant="danger" onClick={() => setConfirmDelete(true)} title="Löschen">
                <IconTrash />
              </Button>
            ) : null}
          </div>
        </div>

        <div className="row row-wrap" style={{ gap: 16, margin: "14px 0 12px", fontSize: 12.5 }}>
          <span>
            <strong>{formatDuration(summary.trackedMinutesTotal)}</strong>{" "}
            <span style={{ color: "var(--text-muted)" }}>erfasst</span>
          </span>
          <span>
            <strong>{formatDuration(summary.unbilledMinutes)}</strong>{" "}
            <span style={{ color: "var(--text-muted)" }}>unabgerechnet</span>
          </span>
          {summary.hourlyRateCents != null ? (
            <>
              <span>
                <strong>{formatCents(summary.unbilledCents)}</strong>{" "}
                <span style={{ color: "var(--text-muted)" }}>offen</span>
              </span>
              <span style={{ color: "var(--text-muted)" }}>
                Satz {formatCents(summary.hourlyRateCents)}/h
              </span>
            </>
          ) : (
            <Badge tone="warn">kein Stundensatz</Badge>
          )}
        </div>

        <div className="tabs">
          <button aria-selected={tab === "tasks"} onClick={() => setTab("tasks")}>
            Aufgaben
          </button>
          <button aria-selected={tab === "time"} onClick={() => setTab("time")}>
            Zeiten
          </button>
          <button aria-selected={tab === "billing"} onClick={() => setTab("billing")}>
            Abrechnung
          </button>
        </div>
      </div>

      <div className="scroll-area" style={{ paddingTop: 4 }}>
        {tab === "tasks" ? <TaskList customerId={summary.id} /> : null}

        {tab === "time" ? (
          <div className="stack">
            <div className="row">
              <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                {entries.length} Einträge
              </span>
              <span className="spacer" />
              <Button onClick={() => setAddingTime(true)}>
                <IconPlus /> Zeit nachtragen
              </Button>
            </div>
            {loadingEntries && entries.length === 0 ? (
              <div className="center-fill" style={{ height: 140 }}>
                <span className="spin" />
              </div>
            ) : (
              <TimeEntryTable
                entries={entries}
                onChanged={() => {
                  loadEntries();
                  refresh();
                }}
              />
            )}
          </div>
        ) : null}

        {tab === "billing" ? <InvoicePanel customer={summary} onChanged={refresh} /> : null}
      </div>

      {editing ? (
        <CustomerFormDialog
          customer={summary}
          onClose={() => setEditing(false)}
          onSaved={refresh}
        />
      ) : null}
      {starting ? (
        <StartTimerDialog presetCustomerId={summary.id} onClose={() => setStarting(false)} />
      ) : null}
      {addingTime ? (
        <TimeEntryFormDialog
          entry={null}
          fixedCustomerId={summary.id}
          onClose={() => setAddingTime(false)}
          onSaved={() => {
            loadEntries();
            refresh();
          }}
        />
      ) : null}
      {confirmArchive ? (
        <ConfirmDialog
          title="Kunde archivieren?"
          confirmLabel="Archivieren"
          message="Der Kunde verschwindet aus den aktiven Listen. Aufgaben und Zeiten bleiben vollständig erhalten und lassen sich jederzeit wieder einblenden."
          onConfirm={() => void setArchived(true)}
          onCancel={() => setConfirmArchive(false)}
        />
      ) : null}
      {confirmDelete ? (
        <ConfirmDialog
          title="Kunde endgültig löschen?"
          destructive
          confirmLabel="Löschen"
          message="Das ist nur möglich, solange keine Aufgaben und Zeiten daran hängen. Der Vorgang lässt sich nicht rückgängig machen."
          onConfirm={remove}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </div>
  );
}
