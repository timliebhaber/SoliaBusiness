import { useCallback, useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { useToast } from "../lib/toast";
import { formatCents, formatDuration } from "../lib/format";
import type { Customer, InvoicePreview, InvoiceResult, SevdeskContact } from "../lib/types";
import {
  Badge,
  Button,
  EmptyState,
  Modal,
  Notice,
  TextInput,
} from "./ui";
import { IconLink, IconReceipt, IconSearch } from "./icons";

function LinkContactDialog({
  customer,
  onClose,
  onLinked,
}: {
  customer: Customer;
  onClose: () => void;
  onLinked: () => void;
}) {
  const toast = useToast();
  const [contacts, setContacts] = useState<SevdeskContact[] | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .sevdeskListContacts(null)
      .then((list) => {
        if (!cancelled) setContacts(list);
      })
      .catch((error) => {
        if (!cancelled) toast.error(error, "SevDesk-Kontakte konnten nicht geladen werden");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const filtered = useMemo(() => {
    if (!contacts) return [];
    const needle = search.trim().toLowerCase();
    if (needle === "") return contacts.slice(0, 60);
    return contacts.filter((c) => c.label.toLowerCase().includes(needle)).slice(0, 60);
  }, [contacts, search]);

  async function link(contactId: string) {
    setBusy(true);
    try {
      await api.sevdeskLinkCustomer(customer.id, contactId);
      onLinked();
      onClose();
    } catch (error) {
      toast.error(error, "Verknüpfung fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function createNew() {
    setBusy(true);
    try {
      const created = await api.sevdeskCreateContact(customer.id);
      toast.success("Kontakt in SevDesk angelegt", created.label);
      onLinked();
      onClose();
    } catch (error) {
      toast.error(error, "Kontakt konnte nicht angelegt werden");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="SevDesk-Kontakt verknüpfen"
      subtitle={`Für „${customer.name}“`}
      wide
      onClose={onClose}
      footer={
        <>
          <Button busy={busy} onClick={createNew}>
            Neu in SevDesk anlegen
          </Button>
          <div className="spacer" />
          <Button onClick={onClose}>Abbrechen</Button>
        </>
      }
    >
      <div className="stack">
        <div className="search">
          <IconSearch />
          <TextInput
            value={search}
            autoFocus
            placeholder="Kontakt suchen"
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
        </div>

        {loading ? (
          <div className="center-fill" style={{ height: 140 }}>
            <span className="spin" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState title="Kein passender Kontakt">
            Lege den Kunden stattdessen neu in SevDesk an.
          </EmptyState>
        ) : (
          <div className="list" style={{ maxHeight: 320, overflowY: "auto" }}>
            {filtered.map((contact) => (
              <button
                key={contact.id}
                className="list-row"
                disabled={busy}
                onClick={() => void link(contact.id)}
              >
                <div className="grow">
                  <div className="primary truncate">{contact.label}</div>
                  <div className="secondary">
                    {contact.customerNumber ? `Kundennr. ${contact.customerNumber}` : `ID ${contact.id}`}
                  </div>
                </div>
                <IconLink style={{ width: 14, height: 14, opacity: 0.6 }} />
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ResultDialog({ result, onClose }: { result: InvoiceResult; onClose: () => void }) {
  return (
    <Modal
      title="Rechnungsentwurf angelegt"
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <Button onClick={onClose}>Schließen</Button>
          <Button variant="primary" onClick={() => void openUrl(result.sevdeskUrl)}>
            In SevDesk öffnen
          </Button>
        </>
      }
    >
      <div className="stack">
        <Notice tone="success">
          Der Entwurf {result.invoiceNumber ? `${result.invoiceNumber} ` : ""}liegt in SevDesk
          bereit. Es wurde nichts versendet — Prüfung und Versand bleiben bei dir.
        </Notice>
        <div className="stat-grid">
          <div className="stat">
            <div className="label">Netto</div>
            <div className="value" style={{ fontSize: 21 }}>
              {formatCents(result.netTotalCents)}
            </div>
          </div>
          <div className="stat">
            <div className="label">Positionen</div>
            <div className="value" style={{ fontSize: 21 }}>
              {result.positions}
            </div>
          </div>
          <div className="stat">
            <div className="label">Markiert</div>
            <div className="value" style={{ fontSize: 21 }}>
              {result.markedTimeEntries}
            </div>
            <div className="foot">Zeiteinträge · {result.markedTasks} Aufgaben</div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function InvoicePanel({
  customer,
  onChanged,
}: {
  customer: Customer;
  onChanged: () => void;
}) {
  const { version, settings } = useStore();
  const toast = useToast();
  const [preview, setPreview] = useState<InvoicePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InvoiceResult | null>(null);
  const [hasToken, setHasToken] = useState<boolean | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .invoicePreview(customer.id)
      .then(setPreview)
      .catch((error) => toast.error(error, "Vorschau konnte nicht erstellt werden"))
      .finally(() => setLoading(false));
  }, [customer.id, toast]);

  useEffect(load, [load, version]);

  useEffect(() => {
    api
      .sevdeskTokenHint()
      .then((hint) => setHasToken(hint !== null))
      .catch(() => setHasToken(false));
  }, []);

  async function create() {
    setBusy(true);
    try {
      const created = await api.createInvoice(customer.id);
      setResult(created);
      setConfirming(false);
      onChanged();
      load();
    } catch (error) {
      toast.error(error, "Rechnung konnte nicht erstellt werden");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !preview) {
    return (
      <div className="center-fill" style={{ height: 180 }}>
        <span className="spin" />
      </div>
    );
  }

  if (!preview) return null;

  const linkBlocker = preview.blockers.find((b) => b.includes("SevDesk-Kontakt"));
  const otherBlockers = preview.blockers.filter((b) => b !== linkBlocker);
  const canCreate = preview.blockers.length === 0 && hasToken === true;

  return (
    <div className="stack">
      {hasToken === false ? (
        <Notice tone="warn">
          Es ist kein SevDesk-API-Key hinterlegt. Die Vorschau funktioniert trotzdem; für den
          Rechnungsentwurf trägst du den Key unter Einstellungen ein.
        </Notice>
      ) : null}

      <div className="card">
        <div className="row">
          <div>
            <div className="card-title" style={{ marginBottom: 2 }}>
              SevDesk-Kontakt
            </div>
            <div style={{ fontSize: 13 }}>
              {customer.sevdeskContactId ? (
                <Badge tone="success">verknüpft · ID {customer.sevdeskContactId}</Badge>
              ) : (
                <Badge tone="warn">nicht verknüpft</Badge>
              )}
            </div>
          </div>
          <span className="spacer" />
          {customer.sevdeskContactId ? (
            <Button
              onClick={async () => {
                try {
                  await api.sevdeskUnlinkCustomer(customer.id);
                  onChanged();
                } catch (error) {
                  toast.error(error, "Verknüpfung konnte nicht gelöst werden");
                }
              }}
            >
              Lösen
            </Button>
          ) : null}
          <Button
            variant={customer.sevdeskContactId ? "default" : "primary"}
            disabled={hasToken === false}
            onClick={() => setLinking(true)}
          >
            <IconLink /> {customer.sevdeskContactId ? "Ändern" : "Verknüpfen"}
          </Button>
        </div>
      </div>

      {otherBlockers.length > 0 ? (
        <Notice tone="warn">
          {otherBlockers.map((blocker) => (
            <div key={blocker}>{blocker}</div>
          ))}
        </Notice>
      ) : null}

      {preview.positions.length === 0 ? (
        <EmptyState icon={<IconReceipt />} title="Nichts abzurechnen">
          Sobald unabgerechnete Zeit vorliegt, entsteht hier die Rechnungsvorschau.
        </EmptyState>
      ) : (
        <>
          <div className="list" style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Position</th>
                  <th className="numeric" style={{ width: 116 }}>Stunden</th>
                  <th className="numeric" style={{ width: 96 }}>Satz</th>
                  <th className="numeric" style={{ width: 104 }}>Netto</th>
                </tr>
              </thead>
              <tbody>
                {preview.positions.map((position, index) => (
                  <tr key={position.taskId ?? `other-${index}`}>
                    <td>
                      <div style={{ fontWeight: 550 }}>{position.name}</div>
                      <div
                        style={{
                          marginTop: 3,
                          fontSize: 11.5,
                          color: "var(--text-muted)",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {position.text}
                      </div>
                    </td>
                    <td className="numeric">
                      {position.hours.toLocaleString("de-DE", { minimumFractionDigits: 2 })}
                      {position.billedMinutes !== position.minutes ? (
                        <div
                          style={{
                            fontSize: 10.5,
                            color: "var(--text-muted)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          getaktet von {formatDuration(position.minutes)}
                        </div>
                      ) : null}
                    </td>
                    <td className="numeric">{formatCents(position.unitPriceCents)}</td>
                    <td className="numeric" style={{ fontWeight: 550 }}>
                      {formatCents(position.netCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="row">
              <span style={{ color: "var(--text-secondary)" }}>
                Netto ({formatDuration(preview.totalMinutes)})
              </span>
              <span className="spacer" />
              <span className="numeric">{formatCents(preview.netTotalCents)}</span>
            </div>
            <div className="row" style={{ marginTop: 4 }}>
              <span style={{ color: "var(--text-secondary)" }}>
                Umsatzsteuer {preview.taxRate.toLocaleString("de-DE")} %
              </span>
              <span className="spacer" />
              <span className="numeric">{formatCents(preview.taxTotalCents)}</span>
            </div>
            <div
              className="row"
              style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line)" }}
            >
              <span style={{ fontWeight: 600 }}>Brutto</span>
              <span className="spacer" />
              <span className="numeric" style={{ fontWeight: 620, fontSize: 15 }}>
                {formatCents(preview.grossTotalCents)}
              </span>
            </div>
          </div>
        </>
      )}

      {preview.tasksWithoutTime.length > 0 ? (
        <Notice tone="info">
          {preview.tasksWithoutTime.length} erledigte Aufgabe(n) ohne offene Zeit erscheinen nicht
          auf der Rechnung und bleiben als „nicht abgerechnet“ stehen:{" "}
          {preview.tasksWithoutTime.slice(0, 5).join(", ")}
          {preview.tasksWithoutTime.length > 5 ? " …" : ""}
        </Notice>
      ) : null}

      <div className="row">
        <span className="spacer" />
        <Button
          variant="primary"
          size="lg"
          disabled={!canCreate}
          title={canCreate ? undefined : preview.blockers.join(" ")}
          onClick={() => setConfirming(true)}
        >
          <IconReceipt /> Rechnungsentwurf erstellen
        </Button>
      </div>

      {linking ? (
        <LinkContactDialog
          customer={customer}
          onClose={() => setLinking(false)}
          onLinked={onChanged}
        />
      ) : null}

      {confirming ? (
        <Modal
          title="Rechnungsentwurf erstellen?"
          subtitle={`${preview.positions.length} Positionen · ${formatCents(preview.netTotalCents)} netto`}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <div className="spacer" />
              <Button onClick={() => setConfirming(false)}>Abbrechen</Button>
              <Button variant="primary" busy={busy} onClick={create}>
                Entwurf anlegen
              </Button>
            </>
          }
        >
          <div className="stack">
            <Notice tone="info">
              In SevDesk entsteht ein <strong>Entwurf</strong>. Nichts wird verschickt und nichts
              festgeschrieben.
            </Notice>
            <div style={{ fontSize: 13, lineHeight: 1.55 }}>
              Danach werden {preview.positions.reduce((sum, p) => sum + p.timeEntryIds.length, 0)}{" "}
              Zeiteinträge und {preview.positions.filter((p) => p.taskId != null).length} Aufgaben
              lokal als abgerechnet markiert. Schlägt das Anlegen fehl, bleibt alles unverändert.
            </div>
            {settings ? (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Steuersatz {settings.taxRate.toLocaleString("de-DE")} % · Zahlungsziel{" "}
                {settings.timeToPayDays} Tage
                {settings.billingIncrementMinutes > 0
                  ? ` · Taktung ${settings.billingIncrementMinutes} min`
                  : ""}
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {result ? <ResultDialog result={result} onClose={() => setResult(null)} /> : null}
    </div>
  );
}
