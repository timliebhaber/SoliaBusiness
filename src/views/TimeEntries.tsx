import { useCallback, useEffect, useMemo, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { useToast } from "../lib/toast";
import { formatCents, formatDuration, isoDate, startOfWeek } from "../lib/format";
import type { TimeEntry, TimeEntryFilter } from "../lib/types";
import { Button, Checkbox, Field, Select, TextInput } from "../components/ui";
import { IconDownload, IconPlus } from "../components/icons";
import { TimeEntryFormDialog, TimeEntryTable } from "../components/TimeEntryTable";

type Range = "today" | "week" | "month" | "all" | "custom";

function rangeToDates(range: Range): { from: string | null; to: string | null } {
  const today = new Date();
  switch (range) {
    case "today":
      return { from: isoDate(today), to: isoDate(today) };
    case "week":
      return { from: isoDate(startOfWeek(today)), to: isoDate(today) };
    case "month":
      return {
        from: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)),
        to: isoDate(today),
      };
    default:
      return { from: null, to: null };
  }
}

export function TimeEntriesView({ customerId }: { customerId: number | null }) {
  const { customers, version, refresh } = useStore();
  const toast = useToast();
  const [range, setRange] = useState<Range>("week");
  const [customFrom, setCustomFrom] = useState(isoDate(startOfWeek()));
  const [customTo, setCustomTo] = useState(isoDate(new Date()));
  const [selectedCustomer, setSelectedCustomer] = useState<number | null>(customerId);
  const [onlyUnbilled, setOnlyUnbilled] = useState(false);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);

  const filter = useMemo<TimeEntryFilter>(() => {
    const dates = range === "custom" ? { from: customFrom, to: customTo } : rangeToDates(range);
    return {
      customerId: selectedCustomer,
      from: dates.from,
      to: dates.to,
      onlyUnbilled,
      limit: 2000,
    };
  }, [range, customFrom, customTo, selectedCustomer, onlyUnbilled]);

  const load = useCallback(() => {
    setLoading(true);
    api
      .listTimeEntries(filter)
      .then(setEntries)
      .catch((error) => toast.error(error, "Zeiten konnten nicht geladen werden"))
      .finally(() => setLoading(false));
  }, [filter, toast]);

  useEffect(load, [load, version]);

  // Aufschlüsselung aus den bereits geladenen Einträgen — sie zeigt damit
  // exakt das, was auch in der Tabelle darunter steht.
  const totals = useMemo(() => {
    const minutes = entries.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0);
    const unbilled = entries
      .filter((e) => !e.invoiced)
      .reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0);

    const grouped = new Map<number, { name: string; minutes: number }>();
    for (const entry of entries) {
      const bucket = grouped.get(entry.customerId) ?? {
        name: entry.customerName,
        minutes: 0,
      };
      bucket.minutes += entry.durationMinutes ?? 0;
      grouped.set(entry.customerId, bucket);
    }

    let cents = 0;
    const byCustomer = [...grouped.entries()]
      .map(([id, bucket]) => {
        const rate = customers.find((c) => c.id === id)?.hourlyRateCents ?? null;
        const amount = rate ? Math.round((bucket.minutes / 60) * rate) : null;
        if (amount) cents += amount;
        return { id, name: bucket.name, minutes: bucket.minutes, cents: amount };
      })
      .sort((a, b) => b.minutes - a.minutes);

    return { minutes, unbilled, cents, byCustomer };
  }, [entries, customers]);

  async function exportCsv() {
    setExporting(true);
    try {
      const suffix = filter.from && filter.to ? `${filter.from}_bis_${filter.to}` : "alle";
      const path = await save({
        defaultPath: `soliabusiness-zeiten-${suffix}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!path) return;
      const count = await api.exportCsv(path, filter);
      toast.success("Export abgeschlossen", `${count} Einträge geschrieben`);
    } catch (error) {
      toast.error(error, "Export fehlgeschlagen");
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <header className="content-header" data-tauri-drag-region>
        <div>
          <h1>Zeiten</h1>
          <div className="sub">
            {formatDuration(totals.minutes)} gesamt · {formatDuration(totals.unbilled)} nicht
            abgerechnet{totals.cents > 0 ? ` · ${formatCents(totals.cents)}` : ""}
          </div>
        </div>
        <div className="header-actions">
          <Button busy={exporting} onClick={exportCsv}>
            <IconDownload /> CSV
          </Button>
          <Button variant="primary" onClick={() => setAdding(true)}>
            <IconPlus /> Zeit nachtragen
          </Button>
        </div>
      </header>

      <div className="scroll-area">
        <div className="stack">
          <div className="card">
            <div className="row row-wrap" style={{ gap: 14, alignItems: "flex-end" }}>
              <div className="segmented">
                {(
                  [
                    ["today", "Heute"],
                    ["week", "Woche"],
                    ["month", "Monat"],
                    ["all", "Alles"],
                    ["custom", "Zeitraum"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    aria-pressed={range === key}
                    onClick={() => setRange(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {range === "custom" ? (
                <>
                  <Field label="Von">
                    <TextInput
                      type="date"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.currentTarget.value)}
                    />
                  </Field>
                  <Field label="Bis">
                    <TextInput
                      type="date"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.currentTarget.value)}
                    />
                  </Field>
                </>
              ) : null}

              <Field label="Kunde">
                <Select
                  value={selectedCustomer ?? ""}
                  onChange={(e) =>
                    setSelectedCustomer(
                      e.currentTarget.value === "" ? null : Number(e.currentTarget.value),
                    )
                  }
                >
                  <option value="">Alle Kunden</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <div style={{ paddingBottom: 6 }}>
                <Checkbox
                  label="Nur nicht abgerechnete"
                  checked={onlyUnbilled}
                  onChange={setOnlyUnbilled}
                />
              </div>
            </div>
          </div>

          {totals.byCustomer.length > 1 ? (
            <div className="card">
              <div className="card-title">Summe je Kunde</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {totals.byCustomer.map((bucket) => (
                  <div key={bucket.id}>
                    <div className="row" style={{ marginBottom: 4 }}>
                      <span className="truncate" style={{ fontWeight: 500 }}>
                        {bucket.name}
                      </span>
                      <span className="spacer" />
                      <span className="numeric" style={{ fontSize: 12 }}>
                        {formatDuration(bucket.minutes)}
                      </span>
                      <span
                        className="numeric"
                        style={{ fontSize: 12, minWidth: 82, color: "var(--text-secondary)" }}
                      >
                        {bucket.cents != null ? formatCents(bucket.cents) : "kein Satz"}
                      </span>
                    </div>
                    <div className="meter">
                      <span
                        style={{
                          width: `${totals.minutes > 0 ? (bucket.minutes / totals.minutes) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {loading && entries.length === 0 ? (
            <div className="center-fill" style={{ height: 180 }}>
              <span className="spin" />
            </div>
          ) : (
            <TimeEntryTable
              entries={entries}
              showCustomer={selectedCustomer == null}
              onChanged={() => {
                load();
                refresh();
              }}
            />
          )}
        </div>
      </div>

      {adding ? (
        <TimeEntryFormDialog
          entry={null}
          onClose={() => setAdding(false)}
          onSaved={() => {
            load();
            refresh();
          }}
        />
      ) : null}
    </>
  );
}
