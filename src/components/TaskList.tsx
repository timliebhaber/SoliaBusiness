import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { useToast } from "../lib/toast";
import {
  daysUntil,
  formatDate,
  formatDuration,
  isOverdue,
  minutesToHoursInput,
  parseHoursToMinutes,
} from "../lib/format";
import type { Task, TaskInput, TaskStatus } from "../lib/types";
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Field,
  Modal,
  Select,
  TextArea,
  TextInput,
} from "./ui";
import { IconCheck, IconPencil, IconPlay, IconPlus, IconTrash, IconInbox } from "./icons";
import { StartTimerDialog } from "./TimerPanel";

type Sort = "deadline" | "status" | "invoiced" | "created";

const STATUS_ORDER: Record<TaskStatus, number> = { in_progress: 0, open: 1, done: 2 };

/** Offene Deadlines zuerst, Aufgaben ohne Termin ans Ende. */
const COMPARATORS: Record<Sort, (a: Task, b: Task) => number> = {
  deadline: (a, b) => {
    if (a.deadline === b.deadline) return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return a.deadline.localeCompare(b.deadline);
  },
  status: (a, b) =>
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.createdAt.localeCompare(a.createdAt),
  invoiced: (a, b) =>
    Number(a.invoiced) - Number(b.invoiced) || STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
  created: (a, b) => b.createdAt.localeCompare(a.createdAt),
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  open: "Offen",
  in_progress: "In Arbeit",
  done: "Erledigt",
};

function TaskFormDialog({
  customerId,
  task,
  onClose,
  onSaved,
}: {
  customerId: number;
  task: Task | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [estimate, setEstimate] = useState(minutesToHoursInput(task?.estimatedMinutes ?? null));
  const [deadline, setDeadline] = useState(task?.deadline ?? "");
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "open");
  const [busy, setBusy] = useState(false);

  const estimateMinutes = useMemo(() => parseHoursToMinutes(estimate), [estimate]);
  const estimateInvalid = estimate.trim() !== "" && estimateMinutes === null;

  async function save() {
    if (title.trim() === "" || estimateInvalid) return;
    const input: TaskInput = {
      customerId,
      title,
      description: description.trim() === "" ? null : description,
      estimatedMinutes: estimateMinutes,
      deadline: deadline === "" ? null : deadline,
      status,
    };
    setBusy(true);
    try {
      if (task) await api.updateTask(task.id, input);
      else await api.createTask(input);
      onSaved();
      onClose();
    } catch (error) {
      toast.error(error, "Aufgabe konnte nicht gespeichert werden");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={task ? "Aufgabe bearbeiten" : "Neue Aufgabe"}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <Button onClick={onClose}>Abbrechen</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={title.trim() === "" || estimateInvalid}
            onClick={save}
          >
            Speichern
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Titel">
          <TextInput
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
            }}
          />
        </Field>
        <Field label="Beschreibung" hint="Markdown ist erlaubt und wird als Text gespeichert.">
          <TextArea
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
          />
        </Field>
        <div className="grid-2">
          <Field
            label="Geschätzte Stunden"
            hint={estimateInvalid ? "z. B. 4 oder 3,5 oder 3:30" : undefined}
          >
            <TextInput
              value={estimate}
              inputMode="decimal"
              placeholder="z. B. 4"
              onChange={(e) => setEstimate(e.currentTarget.value)}
            />
          </Field>
          <Field label="Deadline">
            <TextInput
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.currentTarget.value)}
            />
          </Field>
        </div>
        <Field label="Status">
          <Select
            value={status}
            onChange={(e) => setStatus(e.currentTarget.value as TaskStatus)}
          >
            {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((key) => (
              <option key={key} value={key}>
                {STATUS_LABEL[key]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

function DeadlineBadge({ task }: { task: Task }) {
  if (!task.deadline || task.status === "done") return null;
  if (isOverdue(task.deadline)) {
    const days = Math.abs(daysUntil(task.deadline));
    return (
      <Badge tone="danger">
        {days === 0 ? "heute fällig" : `${days} ${days === 1 ? "Tag" : "Tage"} überfällig`}
      </Badge>
    );
  }
  const days = daysUntil(task.deadline);
  if (days <= 3) return <Badge tone="warn">in {days} {days === 1 ? "Tag" : "Tagen"}</Badge>;
  return <span>fällig {formatDate(task.deadline)}</span>;
}

export function TaskList({ customerId }: { customerId: number }) {
  const { refresh, runningTimer } = useStore();
  const toast = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [filter, setFilter] = useState<"open" | "all" | "unbilled">("open");
  const [sort, setSort] = useState<Sort>("deadline");
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [timerFor, setTimerFor] = useState<Task | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listTasks(customerId)
      .then((list) => {
        if (!cancelled) setTasks(list);
      })
      .catch((error) => toast.error(error, "Aufgaben konnten nicht geladen werden"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId, reload, toast]);

  const reloadAll = () => {
    setReload((n) => n + 1);
    refresh();
  };

  const visible = useMemo(() => {
    const base =
      filter === "all"
        ? tasks
        : filter === "unbilled"
          ? tasks.filter((t) => !t.invoiced)
          : tasks.filter((t) => t.status !== "done");
    return [...base].sort(COMPARATORS[sort]);
  }, [tasks, filter, sort]);

  async function toggleDone(task: Task) {
    setBusyId(task.id);
    try {
      const updated = await api.setTaskStatus(
        task.id,
        task.status === "done" ? "open" : "done",
      );
      setTasks((current) => current.map((t) => (t.id === task.id ? updated : t)));
      refresh();
    } catch (error) {
      toast.error(error, "Status konnte nicht geändert werden");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleInvoiced(task: Task, invoiced: boolean) {
    try {
      const updated = await api.setTaskInvoiced(task.id, invoiced);
      setTasks((current) => current.map((t) => (t.id === task.id ? updated : t)));
    } catch (error) {
      toast.error(error, "Abrechnungsstatus konnte nicht geändert werden");
    }
  }

  async function remove() {
    if (!deleting) return;
    try {
      await api.deleteTask(deleting.id);
      setDeleting(null);
      reloadAll();
    } catch (error) {
      toast.error(error, "Aufgabe konnte nicht gelöscht werden");
    }
  }

  return (
    <div className="stack">
      <div className="row">
        <div className="segmented">
          <button aria-pressed={filter === "open"} onClick={() => setFilter("open")}>
            Offen
          </button>
          <button aria-pressed={filter === "unbilled"} onClick={() => setFilter("unbilled")}>
            Nicht abgerechnet
          </button>
          <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            Alle
          </button>
        </div>
        <span className="spacer" />
        <Select
          value={sort}
          style={{ width: 168 }}
          aria-label="Sortierung"
          onChange={(e) => setSort(e.currentTarget.value as Sort)}
        >
          <option value="deadline">Nach Deadline</option>
          <option value="status">Nach Status</option>
          <option value="invoiced">Nach Abrechnung</option>
          <option value="created">Zuletzt angelegt</option>
        </Select>
        <Button onClick={() => setCreating(true)}>
          <IconPlus /> Aufgabe
        </Button>
      </div>

      {loading && tasks.length === 0 ? (
        <div className="center-fill" style={{ height: 140 }}>
          <span className="spin" />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState icon={<IconInbox />} title="Keine Aufgaben in dieser Ansicht">
          {filter === "open" ? "Alles erledigt." : "Leg eine Aufgabe an."}
        </EmptyState>
      ) : (
        <div className="list">
          {visible.map((task) => (
            <div key={task.id} className={`task-row ${task.status === "done" ? "done" : ""}`}>
              <button
                className={`task-check ${task.status === "done" ? "checked" : ""}`}
                disabled={busyId === task.id}
                aria-label={task.status === "done" ? "Als offen markieren" : "Als erledigt markieren"}
                onClick={() => void toggleDone(task)}
              >
                <IconCheck />
              </button>

              <div className="grow" style={{ minWidth: 0 }}>
                <div className="task-title">{task.title}</div>
                <div className="task-meta">
                  {task.status === "in_progress" ? <Badge tone="accent">In Arbeit</Badge> : null}
                  <DeadlineBadge task={task} />
                  {task.estimatedMinutes != null ? (
                    <span>
                      {formatDuration(task.trackedMinutes)} von{" "}
                      {formatDuration(task.estimatedMinutes)}
                    </span>
                  ) : task.trackedMinutes > 0 ? (
                    <span>{formatDuration(task.trackedMinutes)} erfasst</span>
                  ) : null}
                  {task.invoiced ? <Badge tone="success">abgerechnet</Badge> : null}
                  {runningTimer?.taskId === task.id ? (
                    <Badge tone="running">
                      <span className="dot" /> läuft
                    </Badge>
                  ) : null}
                </div>
                {task.description ? <div className="task-desc">{task.description}</div> : null}
                {task.estimatedMinutes ? (
                  <div className="meter" style={{ marginTop: 6, maxWidth: 220 }}>
                    <span
                      style={{
                        width: `${Math.min(100, (task.trackedMinutes / task.estimatedMinutes) * 100)}%`,
                        background:
                          task.trackedMinutes > task.estimatedMinutes
                            ? "var(--danger)"
                            : "var(--accent)",
                      }}
                    />
                  </div>
                ) : null}
              </div>

              <div className="row" style={{ alignItems: "center", gap: 10 }}>
                <Checkbox
                  label="abgerechnet"
                  checked={task.invoiced}
                  onChange={(value) => void toggleInvoiced(task, value)}
                />
                <div className="task-actions">
                  {!runningTimer ? (
                    <Button
                      variant="ghost"
                      className="btn-icon"
                      title="Timer für diese Aufgabe starten"
                      onClick={() => setTimerFor(task)}
                    >
                      <IconPlay />
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    className="btn-icon"
                    title="Bearbeiten"
                    onClick={() => setEditing(task)}
                  >
                    <IconPencil />
                  </Button>
                  <Button
                    variant="ghost"
                    className="btn-icon"
                    title="Löschen"
                    onClick={() => setDeleting(task)}
                  >
                    <IconTrash />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating ? (
        <TaskFormDialog
          customerId={customerId}
          task={null}
          onClose={() => setCreating(false)}
          onSaved={reloadAll}
        />
      ) : null}
      {editing ? (
        <TaskFormDialog
          customerId={customerId}
          task={editing}
          onClose={() => setEditing(null)}
          onSaved={reloadAll}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title="Aufgabe löschen?"
          destructive
          confirmLabel="Löschen"
          message={
            <>
              „{deleting.title}“ wird entfernt. Bereits erfasste Zeiten bleiben erhalten und
              laufen künftig ohne Aufgabenzuordnung.
            </>
          }
          onConfirm={remove}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
      {timerFor ? (
        <StartTimerDialog
          presetCustomerId={customerId}
          presetTaskId={timerFor.id}
          onClose={() => setTimerFor(null)}
        />
      ) : null}
    </div>
  );
}
