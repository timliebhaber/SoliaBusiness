import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { useToast } from "../lib/toast";
import { formatStopwatch, formatDuration, toLocalInput, fromLocalInput } from "../lib/format";
import type { Task } from "../lib/types";
import { Button, ConfirmDialog, Field, Modal, Select, TextArea, TextInput } from "./ui";
import { IconPlay, IconStop } from "./icons";

function useElapsed(startTime: string | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startTime) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startTime]);
  if (!startTime) return 0;
  return Math.max(0, Math.floor((now - new Date(startTime).getTime()) / 1000));
}

export function StartTimerDialog({
  onClose,
  presetCustomerId,
  presetTaskId,
}: {
  onClose: () => void;
  presetCustomerId?: number;
  presetTaskId?: number | null;
}) {
  const { customers, refresh } = useStore();
  const toast = useToast();
  const active = useMemo(() => customers.filter((c) => !c.archived), [customers]);
  const [customerId, setCustomerId] = useState<number | null>(
    presetCustomerId ?? active[0]?.id ?? null,
  );
  const [taskId, setTaskId] = useState<number | null>(presetTaskId ?? null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (customerId == null) {
      setTasks([]);
      return;
    }
    let cancelled = false;
    api
      .listTasks(customerId)
      .then((list) => {
        if (!cancelled) setTasks(list.filter((t) => t.status !== "done" || t.id === presetTaskId));
      })
      .catch((error) => toast.error(error, "Aufgaben konnten nicht geladen werden"));
    return () => {
      cancelled = true;
    };
  }, [customerId, presetTaskId, toast]);

  async function start() {
    if (customerId == null) return;
    setBusy(true);
    try {
      await api.startTimer(customerId, taskId);
      refresh();
      onClose();
    } catch (error) {
      toast.error(error, "Timer konnte nicht gestartet werden");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Timer starten"
      subtitle="Die Notiz wird erst beim Stoppen erfasst."
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="running" busy={busy} disabled={customerId == null} onClick={start}>
            <IconPlay /> Starten
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Kunde">
          <Select
            value={customerId ?? ""}
            onChange={(e) => {
              setCustomerId(Number(e.currentTarget.value));
              setTaskId(null);
            }}
          >
            {active.length === 0 ? <option value="">Keine aktiven Kunden</option> : null}
            {active.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
                {customer.company ? ` — ${customer.company}` : ""}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Aufgabe" hint="Optional — Zeit lässt sich auch ohne Aufgabe erfassen.">
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
    </Modal>
  );
}

export function StopTimerDialog({ onClose }: { onClose: () => void }) {
  const { runningTimer, refresh } = useStore();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const elapsed = useElapsed(runningTimer?.startTime);

  if (!runningTimer) return null;

  async function stop() {
    if (note.trim() === "") return;
    setBusy(true);
    try {
      const entry = await api.stopTimer(note);
      refresh();
      toast.success(
        "Zeit gebucht",
        `${formatDuration(entry.durationMinutes)} für ${entry.customerName}`,
      );
      onClose();
    } catch (error) {
      toast.error(error, "Timer konnte nicht gestoppt werden");
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    setBusy(true);
    try {
      await api.discardTimer();
      refresh();
      toast.info("Timer verworfen");
      onClose();
    } catch (error) {
      toast.error(error, "Timer konnte nicht verworfen werden");
    } finally {
      setBusy(false);
      setConfirmDiscard(false);
    }
  }

  if (confirmDiscard) {
    return (
      <ConfirmDialog
        title="Timer verwerfen?"
        message={`Die erfassten ${formatStopwatch(elapsed)} werden nicht gespeichert.`}
        confirmLabel="Verwerfen"
        destructive
        busy={busy}
        onConfirm={discard}
        onCancel={() => setConfirmDiscard(false)}
      />
    );
  }

  return (
    <Modal
      title="Timer stoppen"
      subtitle={
        <>
          {runningTimer.customerName}
          {runningTimer.taskTitle ? ` · ${runningTimer.taskTitle}` : ""} ·{" "}
          <span className="mono">{formatStopwatch(elapsed)}</span>
        </>
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="danger" onClick={() => setConfirmDiscard(true)}>
            Verwerfen
          </Button>
          <div className="spacer" />
          <Button onClick={onClose}>Weiterlaufen lassen</Button>
          <Button variant="primary" busy={busy} disabled={note.trim() === ""} onClick={stop}>
            Zeit buchen
          </Button>
        </>
      }
    >
      <Field
        label="Woran hast du gearbeitet?"
        hint="Pflichtfeld — die Notiz landet später als Text auf der Rechnungsposition."
      >
        <TextArea
          value={note}
          autoFocus
          placeholder="z. B. Startseite umgebaut, Kontaktformular angebunden"
          onChange={(e) => setNote(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void stop();
          }}
        />
      </Field>
    </Modal>
  );
}

function EditRunningDialog({ onClose }: { onClose: () => void }) {
  const { runningTimer, refresh } = useStore();
  const toast = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskId, setTaskId] = useState<number | null>(runningTimer?.taskId ?? null);
  const [start, setStart] = useState(() =>
    runningTimer ? toLocalInput(runningTimer.startTime) : "",
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!runningTimer) return;
    api
      .listTasks(runningTimer.customerId)
      .then((list) => setTasks(list.filter((t) => t.status !== "done" || t.id === taskId)))
      .catch((error) => toast.error(error, "Aufgaben konnten nicht geladen werden"));
    // Nur beim Öffnen laden — die Auswahl soll währenddessen nicht springen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningTimer?.customerId]);

  if (!runningTimer) return null;

  async function save() {
    setBusy(true);
    try {
      await api.updateRunningTimer(taskId, fromLocalInput(start));
      refresh();
      onClose();
    } catch (error) {
      toast.error(error, "Änderung nicht möglich");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Laufenden Timer anpassen"
      subtitle={runningTimer.customerName}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" busy={busy} onClick={save}>
            Übernehmen
          </Button>
        </>
      }
    >
      <div className="stack">
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
        <Field label="Startzeit" hint="Korrigierbar, falls der Start vergessen wurde.">
          <TextInput
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.currentTarget.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}

export function TimerPanel({ onStop }: { onStop: () => void }) {
  const { runningTimer } = useStore();
  const [starting, setStarting] = useState(false);
  const [editing, setEditing] = useState(false);
  const elapsed = useElapsed(runningTimer?.startTime);

  return (
    <>
      <div className={`timer-panel ${runningTimer ? "running" : ""}`}>
        {runningTimer ? (
          <>
            <div className="row">
              <span className="pulse" />
              <span className="timer-clock">{formatStopwatch(elapsed)}</span>
            </div>
            <div className="timer-label truncate">
              {runningTimer.customerName}
              {runningTimer.taskTitle ? ` · ${runningTimer.taskTitle}` : ""}
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <Button variant="running" onClick={onStop} style={{ flex: 1 }}>
                <IconStop /> Stoppen
              </Button>
              <Button
                variant="ghost"
                className="btn-icon"
                title="Aufgabe oder Startzeit ändern"
                onClick={() => setEditing(true)}
              >
                ⋯
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="timer-idle">Kein Timer aktiv</div>
            <Button block variant="default" style={{ marginTop: 8 }} onClick={() => setStarting(true)}>
              <IconPlay /> Timer starten
            </Button>
          </>
        )}
      </div>

      {starting ? <StartTimerDialog onClose={() => setStarting(false)} /> : null}
      {editing ? <EditRunningDialog onClose={() => setEditing(false)} /> : null}
    </>
  );
}
