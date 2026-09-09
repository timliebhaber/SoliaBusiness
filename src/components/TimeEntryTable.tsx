import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { useToast } from "../lib/toast";
import {
  formatDate,
  formatDuration,
  formatTime,
  fromLocalInput,
  toLocalInput,
} from "../lib/format";
import type { Task, TimeEntry } from "../lib/types";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Modal,
  Select,
  TextArea,
  TextInput,
} from "./ui";
import { IconClock, IconPencil, IconTrash } from "./icons";

/** Legt Zeit nachträglich an oder korrigiert einen bestehenden Eintrag. */
export function TimeEntryFormDialog({
  entry,
  fixedCustomerId,
  onClose,
  onSaved,
}: {
  entry: TimeEntry | null;
  fixedCustomerId?: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { customers } = useStore();
  const toast = useToast();
  const active = useMemo(
    () => customers.filter((c) => !c.archived || c.id === entry?.customerId),
    [customers, entry?.customerId],
  );

  const [customerId, setCustomerId] = useState<number>(
    entry?.customerId ?? fixedCustomerId ?? active[0]?.id ?? 0,
  );
  const [taskId, setTaskId] = useState<number | null>(entry?.taskId ?? null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [start, setStart] = useState(() =>
    entry ? toLocalInput(entry.startTime) : toLocalInput(new Date(Date.now() - 3_600_000).toISOString()),
  );
  const [end, setEnd] = useState(() =>
    entry?.endTime ? toLocalInput(entry.endTime) : toLocalInput(new Date().toISOString()),
  );
  const [note, setNote] = useState(entry?.note ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    api
      .listTasks(customerId)
      .then((list) => {
        if (!cancelled) setTasks(list);
      })
      .catch((error) => toast.error(error, "Aufgaben konnten nicht geladen werden"));
    return () => {
      cancelled = true;
    };
  }, [customerId, toast]);

  const minutes = useMemo(() => {
    const from = new Date(start).getTime();
    const to = new Date(end).getTime();
    if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return null;
    return Math.round((to - from) / 60000);
  }, [start, end]);

  async function save() {
    const startIso = fromLocalInput(start);
    const endIso = fromLocalInput(end);
    if (!startIso || !endIso || note.trim() === "" || minutes == null) return;

    setBusy(true);
    try {
      if (entry) {
        await api.updateTimeEntry({
          id: entry.id,
          customerId,
          taskId,
          startTime: startIso,
          endTime: endIso,
          note,
        });
      } else {
        await api.createTimeEntry({
          customerId,
          taskId,
          startTime: startIso,
          endTime: endIso,
          note,
        });
      }
      onSaved();
      onClose();
    } catch (error) {
      toast.error(error, "Zeiteintrag konnte nicht gespeichert werden");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={entry ? "Zeit bearbeiten" : "Zeit nachtragen"}
      subtitle={minutes != null ? `Dauer: ${formatDuration(minutes)}` : "Ende muss nach dem Start liegen"}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <Button onClick={onClose}>Abbrechen</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={minutes == null || note.trim() === ""}
            onClick={save}
          >
            Speichern
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="grid-2">
          <Field label="Kunde">
            <Select
              value={customerId}
              disabled={fixedCustomerId != null}
              onChange={(e) => {
                setCustomerId(Number(e.currentTarget.value));
                setTaskId(null);
              }}
            >
              {active.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Aufgabe">
            <Select
              value={taskId ?? ""}
              onChange={(e) =>
                setTaskId(e.currentTarget.value === "" ? null : Number(e.currentTarget.value))
              }
            >
              <option value="">Ohne Aufgabe</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Beginn">
            <TextInput
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.currentTarget.value)}
            />
          </Field>
          <Field label="Ende">
            <TextInput
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.currentTarget.value)}
            />
          </Field>
        </div>
        <Field label="Notiz" hint="Pflichtfeld — beschreibt, was in dieser Zeit passiert ist.">
          <TextArea value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function TimeEntryTable({
  entries,
  showCustomer,
  onChanged,
}: {
  entries: TimeEntry[];
  showCustomer?: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [deleting, setDeleting] = useState<TimeEntry | null>(null);

  async function toggleInvoiced(entry: TimeEntry) {
    try {
      await api.setTimeEntryInvoiced(entry.id, !entry.invoiced);
      onChanged();
    } catch (error) {
      toast.error(error, "Abrechnungsstatus konnte nicht geändert werden");
    }
  }

  async function remove() {
    if (!deleting) return;
    try {
      await api.deleteTimeEntry(deleting.id);
      setDeleting(null);
      onChanged();
    } catch (error) {
      toast.error(error, "Eintrag konnte nicht gelöscht werden");
    }
  }

  if (entries.length === 0) {
    return (
      <EmptyState icon={<IconClock />} title="Keine Zeiten im gewählten Zeitraum">
        Timer starten oder Zeit nachtragen.
      </EmptyState>
    );
  }

  return (
    <>
      <div className="list" style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 92 }}>Datum</th>
              <th style={{ width: 106 }}>Zeitraum</th>
              <th className="numeric" style={{ width: 72 }}>Dauer</th>
              {showCustomer ? <th style={{ width: 150 }}>Kunde</th> : null}
              <th style={{ width: 160 }}>Aufgabe</th>
              <th>Notiz</th>
              <th style={{ width: 108 }}>Abgerechnet</th>
              <th style={{ width: 62 }} />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td style={{ whiteSpace: "nowrap" }}>{formatDate(entry.startTime)}</td>
                <td style={{ whiteSpace: "nowrap", color: "var(--text-secondary)" }}>
                  {formatTime(entry.startTime)}–{formatTime(entry.endTime)}
                </td>
                <td className="numeric" style={{ fontWeight: 550 }}>
                  {formatDuration(entry.durationMinutes)}
                </td>
                {showCustomer ? <td className="truncate">{entry.customerName}</td> : null}
                <td style={{ color: "var(--text-secondary)" }}>
                  {entry.taskTitle ?? <span style={{ color: "var(--text-muted)" }}>—</span>}
                </td>
                <td style={{ whiteSpace: "pre-wrap" }}>{entry.note}</td>
                <td>
                  <button
                    className="btn btn-ghost"
                    style={{ height: 22, padding: "0 6px" }}
                    onClick={() => void toggleInvoiced(entry)}
                  >
                    {entry.invoiced ? (
                      <Badge tone="success">ja</Badge>
                    ) : (
                      <Badge tone="neutral">nein</Badge>
                    )}
                  </button>
                </td>
                <td>
                  <div className="row" style={{ gap: 2, justifyContent: "flex-end" }}>
                    <Button
                      variant="ghost"
                      className="btn-icon"
                      title={entry.invoiced ? "Abgerechnete Einträge sind gesperrt" : "Bearbeiten"}
                      disabled={entry.invoiced}
                      onClick={() => setEditing(entry)}
                    >
                      <IconPencil />
                    </Button>
                    <Button
                      variant="ghost"
                      className="btn-icon"
                      title={entry.invoiced ? "Abgerechnete Einträge sind gesperrt" : "Löschen"}
                      disabled={entry.invoiced}
                      onClick={() => setDeleting(entry)}
                    >
                      <IconTrash />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing ? (
        <TimeEntryFormDialog
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={onChanged}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title="Zeiteintrag löschen?"
          destructive
          confirmLabel="Löschen"
          message={`${formatDate(deleting.startTime)} · ${formatDuration(deleting.durationMinutes)} · ${deleting.note ?? ""}`}
          onConfirm={remove}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </>
  );
}
