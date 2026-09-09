import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { useToast } from "../lib/toast";
import { formatCents, formatDateTime, formatDuration } from "../lib/format";
import type { InvoiceRecord } from "../lib/types";
import type { Route } from "../lib/routes";
import { Badge, Button, EmptyState } from "../components/ui";
import { IconReceipt } from "../components/icons";

export function InvoicesView({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const { version, customers } = useStore();
  const toast = useToast();
  const [records, setRecords] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listInvoices()
      .then((list) => {
        if (!cancelled) setRecords(list);
      })
      .catch((error) => toast.error(error, "Rechnungen konnten nicht geladen werden"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [version, toast]);

  const openCandidates = customers
    .filter((c) => !c.archived && c.unbilledMinutes > 0)
    .sort((a, b) => b.unbilledMinutes - a.unbilledMinutes);

  return (
    <>
      <header className="content-header" data-tauri-drag-region>
        <div>
          <h1>Rechnungen</h1>
          <div className="sub">In SevDesk angelegte Entwürfe und offene Posten</div>
        </div>
      </header>

      <div className="scroll-area">
        <div className="stack" style={{ gap: 20 }}>
          <div>
            <div className="card-title">Bereit zur Abrechnung</div>
            {openCandidates.length === 0 ? (
              <div className="card" style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                Nichts offen — alle erfassten Zeiten sind abgerechnet.
              </div>
            ) : (
              <div className="list">
                {openCandidates.map((customer) => (
                  <button
                    key={customer.id}
                    className="list-row"
                    onClick={() => onNavigate({ name: "customers", customerId: customer.id })}
                  >
                    <div className="grow">
                      <div className="primary truncate">{customer.name}</div>
                      <div className="secondary">
                        {formatDuration(customer.unbilledMinutes)} unabgerechnet
                        {customer.sevdeskContactId ? "" : " · kein SevDesk-Kontakt"}
                      </div>
                    </div>
                    {customer.hourlyRateCents ? (
                      <span className="numeric" style={{ fontWeight: 550 }}>
                        {formatCents(customer.unbilledCents)}
                      </span>
                    ) : (
                      <Badge tone="warn">kein Satz</Badge>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="card-title">Verlauf</div>
            {loading && records.length === 0 ? (
              <div className="center-fill" style={{ height: 140 }}>
                <span className="spin" />
              </div>
            ) : records.length === 0 ? (
              <EmptyState icon={<IconReceipt />} title="Noch keine Rechnung erstellt">
                Entwürfe erscheinen hier, sobald du sie aus einem Kunden heraus anlegst.
              </EmptyState>
            ) : (
              <div className="list" style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 140 }}>Erstellt</th>
                      <th>Kunde</th>
                      <th style={{ width: 120 }}>Nummer</th>
                      <th className="numeric" style={{ width: 88 }}>Zeit</th>
                      <th className="numeric" style={{ width: 104 }}>Netto</th>
                      <th style={{ width: 130 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((record) => (
                      <tr key={record.id}>
                        <td style={{ whiteSpace: "nowrap" }}>{formatDateTime(record.createdAt)}</td>
                        <td className="truncate">{record.customerName}</td>
                        <td className="mono">{record.invoiceNumber ?? "—"}</td>
                        <td className="numeric">{formatDuration(record.minutes)}</td>
                        <td className="numeric" style={{ fontWeight: 550 }}>
                          {formatCents(record.netTotalCents)}
                        </td>
                        <td>
                          {record.sevdeskInvoiceId ? (
                            <Button
                              variant="ghost"
                              onClick={() =>
                                void openUrl(
                                  `https://my.sevdesk.de/fi/edit/type/RE/id/${record.sevdeskInvoiceId}`,
                                )
                              }
                            >
                              In SevDesk öffnen
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
