import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { useToast } from "../lib/toast";
import {
  centsToEuroInput,
  formatCents,
  formatDuration,
  parseEuroToCents,
} from "../lib/format";
import type { Customer, CustomerInput, CustomerSummary } from "../lib/types";
import type { Route } from "../lib/routes";
import {
  Badge,
  Button,
  Checkbox,
  Field,
  Modal,
  TextArea,
  TextInput,
  EmptyState,
} from "../components/ui";
import { IconPlus, IconSearch, IconUsers } from "../components/icons";
import { CustomerDetail } from "./CustomerDetail";

export function CustomerFormDialog({
  customer,
  onClose,
  onSaved,
}: {
  customer: Customer | null;
  onClose: () => void;
  onSaved: (customer: Customer) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(customer?.name ?? "");
  const [company, setCompany] = useState(customer?.company ?? "");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [rate, setRate] = useState(centsToEuroInput(customer?.hourlyRateCents ?? null));
  const [notes, setNotes] = useState(customer?.notes ?? "");
  const [busy, setBusy] = useState(false);

  const rateCents = useMemo(() => parseEuroToCents(rate), [rate]);
  const rateInvalid = rate.trim() !== "" && rateCents === null;

  async function save() {
    if (name.trim() === "" || rateInvalid) return;
    const input: CustomerInput = {
      name,
      company: company.trim() === "" ? null : company,
      email: email.trim() === "" ? null : email,
      hourlyRateCents: rateCents,
      notes: notes.trim() === "" ? null : notes,
    };
    setBusy(true);
    try {
      const saved = customer
        ? await api.updateCustomer(customer.id, input)
        : await api.createCustomer(input);
      onSaved(saved);
      onClose();
    } catch (error) {
      toast.error(error, "Kunde konnte nicht gespeichert werden");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={customer ? "Kunde bearbeiten" : "Neuer Kunde"}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <Button onClick={onClose}>Abbrechen</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={name.trim() === "" || rateInvalid}
            onClick={save}
          >
            Speichern
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Name">
          <TextInput
            value={name}
            autoFocus
            placeholder="Ansprechpartner oder Kundenname"
            onChange={(e) => setName(e.currentTarget.value)}
          />
        </Field>
        <div className="grid-2">
          <Field label="Firma">
            <TextInput value={company} onChange={(e) => setCompany(e.currentTarget.value)} />
          </Field>
          <Field label="E-Mail">
            <TextInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
            />
          </Field>
        </div>
        <Field
          label="Stundensatz (netto)"
          hint={
            rateInvalid
              ? "Bitte als Zahl eingeben, z. B. 95,00"
              : "Grundlage für Rechnungssummen. Leer lassen, wenn variabel."
          }
        >
          <TextInput
            value={rate}
            inputMode="decimal"
            placeholder="z. B. 95,00"
            onChange={(e) => setRate(e.currentTarget.value)}
          />
        </Field>
        <Field label="Notizen">
          <TextArea value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function CustomerRow({
  customer,
  selected,
  onSelect,
}: {
  customer: CustomerSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button className={`list-row ${selected ? "selected" : ""}`} onClick={onSelect}>
      <div className="grow">
        <div className="primary truncate">
          {customer.name}
          {customer.archived ? (
            <span style={{ marginLeft: 6 }}>
              <Badge tone="neutral">Archiviert</Badge>
            </span>
          ) : null}
        </div>
        <div className="secondary truncate">
          {customer.company ?? customer.email ?? "—"}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        {customer.unbilledMinutes > 0 ? (
          <div className="numeric" style={{ fontSize: 12, fontWeight: 550 }}>
            {customer.hourlyRateCents
              ? formatCents(customer.unbilledCents)
              : formatDuration(customer.unbilledMinutes)}
          </div>
        ) : null}
        <div className="row" style={{ gap: 4, justifyContent: "flex-end", marginTop: 2 }}>
          {customer.overdueTasks > 0 ? (
            <Badge tone="danger">{customer.overdueTasks} überfällig</Badge>
          ) : customer.openTasks > 0 ? (
            <Badge tone="neutral">{customer.openTasks} offen</Badge>
          ) : null}
        </div>
      </div>
    </button>
  );
}

export function CustomersView({
  selectedId,
  onSelect,
  onNavigate,
}: {
  selectedId: number | null;
  onSelect: (id: number) => void;
  onNavigate: (route: Route) => void;
}) {
  const { version, refresh } = useStore();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [list, setList] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const handle = window.setTimeout(() => {
      api
        .listCustomers(includeArchived, search.trim() === "" ? null : search)
        .then((result) => {
          if (!cancelled) setList(result);
        })
        .catch((error) => toast.error(error, "Kunden konnten nicht geladen werden"))
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, search === "" ? 0 : 180);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [search, includeArchived, version, toast]);

  const selected = useMemo(
    () => list.find((c) => c.id === selectedId) ?? null,
    [list, selectedId],
  );

  return (
    <>
      <header className="content-header" data-tauri-drag-region>
        <div>
          <h1>Kunden</h1>
          <div className="sub">{list.length} Einträge</div>
        </div>
        <div className="header-actions">
          <div className="search" style={{ width: 210 }}>
            <IconSearch />
            <TextInput
              value={search}
              placeholder="Suchen"
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
          </div>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <IconPlus /> Neuer Kunde
          </Button>
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "294px 1fr", flex: 1, minHeight: 0 }}>
        <div
          style={{
            borderRight: "1px solid var(--line)",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)" }}>
            <Checkbox
              label="Archivierte anzeigen"
              checked={includeArchived}
              onChange={setIncludeArchived}
            />
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {loading && list.length === 0 ? (
              <div className="center-fill" style={{ height: 160 }}>
                <span className="spin" />
              </div>
            ) : list.length === 0 ? (
              <EmptyState
                icon={<IconUsers />}
                title={search ? "Nichts gefunden" : "Noch keine Kunden"}
              >
                {search ? "Andere Suche versuchen." : "Leg deinen ersten Kunden an."}
              </EmptyState>
            ) : (
              list.map((customer) => (
                <CustomerRow
                  key={customer.id}
                  customer={customer}
                  selected={customer.id === selectedId}
                  onSelect={() => onSelect(customer.id)}
                />
              ))
            )}
          </div>
        </div>

        <div style={{ minWidth: 0, overflow: "hidden", display: "flex" }}>
          {selected ? (
            <CustomerDetail key={selected.id} summary={selected} onNavigate={onNavigate} />
          ) : (
            <EmptyState icon={<IconUsers />} title="Kunde auswählen">
              Links einen Kunden wählen, um Aufgaben, Zeiten und Abrechnung zu sehen.
            </EmptyState>
          )}
        </div>
      </div>

      {creating ? (
        <CustomerFormDialog
          customer={null}
          onClose={() => setCreating(false)}
          onSaved={(customer) => {
            refresh();
            onSelect(customer.id);
          }}
        />
      ) : null}
    </>
  );
}
