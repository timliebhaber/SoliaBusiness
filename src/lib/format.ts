const currency = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const decimal = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Dauer als „3:05 h“ — die im Zeiterfassungsalltag übliche Schreibweise. */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null) return "—";
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(minutes);
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")} h`;
}

export function formatStopwatch(seconds: number): string {
  const abs = Math.max(0, Math.floor(seconds));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatDecimalHours(minutes: number): string {
  return `${decimal.format(minutes / 60)} h`;
}

export function formatCents(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return currency.format(cents / 100);
}

/** Eingabefelder arbeiten mit Euro, gespeichert wird in Cent. */
export function parseEuroToCents(value: string): number | null {
  const cleaned = value.trim().replace(/\s|€/g, "").replace(",", ".");
  if (cleaned === "") return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

export function centsToEuroInput(cents: number | null): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

/** „2,5“ oder „2:30“ → 150 Minuten. */
export function parseHoursToMinutes(value: string): number | null {
  const raw = value.trim();
  if (raw === "") return null;
  if (raw.includes(":")) {
    const [h = "0", m = "0"] = raw.split(":");
    const hours = Number(h);
    const mins = Number(m);
    if (!Number.isFinite(hours) || !Number.isFinite(mins)) return null;
    return Math.round(hours * 60 + mins);
  }
  const parsed = Number(raw.replace(",", "."));
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 60);
}

export function minutesToHoursInput(minutes: number | null): string {
  if (minutes == null) return "";
  return (minutes / 60).toFixed(2).replace(/\.?0+$/, "").replace(".", ",");
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

export function formatWeekday(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00`);
  return date.toLocaleDateString("de-DE", { weekday: "short" });
}

/** RFC3339 (UTC) → Wert für <input type="datetime-local"> in lokaler Zeit. */
export function toLocalInput(rfc3339: string): string {
  const date = new Date(rfc3339);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function startOfWeek(date = new Date()): Date {
  const copy = new Date(date);
  const day = (copy.getDay() + 6) % 7; // Montag = 0
  copy.setDate(copy.getDate() - day);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function isOverdue(deadline: string | null): boolean {
  if (!deadline) return false;
  return deadline < isoDate(new Date());
}

export function daysUntil(deadline: string): number {
  const target = new Date(`${deadline}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}
