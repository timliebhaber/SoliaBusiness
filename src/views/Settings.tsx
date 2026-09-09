import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { useToast } from "../lib/toast";
import type { AppInfo, AppSettings, SevdeskStatus } from "../lib/types";
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Field,
  Notice,
  Select,
  TextArea,
  TextInput,
} from "../components/ui";

const INCREMENTS = [0, 5, 6, 10, 15, 30, 60];

export function SettingsView() {
  const { settings, reloadSettings } = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState<AppSettings | null>(settings);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [tokenHint, setTokenHint] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<SevdeskStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => setDraft(settings), [settings]);

  useEffect(() => {
    api.appInfo().then(setInfo).catch(() => setInfo(null));
    api
      .sevdeskTokenHint()
      .then(setTokenHint)
      .catch((error) => toast.error(error, "Schlüsselbund nicht lesbar"));
  }, [toast]);

  function patch(changes: Partial<AppSettings>) {
    setDraft((current) => (current ? { ...current, ...changes } : current));
  }

  async function saveToken() {
    if (token.trim() === "") return;
    try {
      const hint = await api.setSevdeskToken(token);
      setTokenHint(hint);
      setToken("");
      setStatus(null);
      toast.success("API-Key im Schlüsselbund gespeichert");
    } catch (error) {
      toast.error(error, "API-Key konnte nicht gespeichert werden");
    }
  }

  async function clearToken() {
    try {
      await api.clearSevdeskToken();
      setTokenHint(null);
      setStatus(null);
      setConfirmClear(false);
      toast.info("API-Key entfernt");
    } catch (error) {
      toast.error(error, "API-Key konnte nicht entfernt werden");
    }
  }

  async function testConnection() {
    setTesting(true);
    try {
      const result = await api.sevdeskStatus();
      setStatus(result);
      toast.success("Verbindung steht", result.userName ? `Angemeldet als ${result.userName}` : undefined);
      await reloadSettings();
    } catch (error) {
      setStatus(null);
      toast.error(error, "Verbindung fehlgeschlagen");
    } finally {
      setTesting(false);
    }
  }

  async function saveSettings() {
    if (!draft) return;
    setSaving(true);
    try {
      await api.saveSettings(draft);
      await reloadSettings();
      toast.success("Einstellungen gespeichert");
    } catch (error) {
      toast.error(error, "Einstellungen konnten nicht gespeichert werden");
    } finally {
      setSaving(false);
    }
  }

  if (!draft) {
    return (
      <div className="center-fill">
        <span className="spin" />
      </div>
    );
  }

  return (
    <>
      <header className="content-header" data-tauri-drag-region>
        <div>
          <h1>Einstellungen</h1>
          <div className="sub">SevDesk-Anbindung, Rechnungsvorgaben und Ablage</div>
        </div>
        <div className="header-actions">
          <Button variant="primary" busy={saving} onClick={saveSettings}>
            Speichern
          </Button>
        </div>
      </header>

      <div className="scroll-area">
        <div className="stack" style={{ gap: 20, maxWidth: 720 }}>
          {/* ------------------------------------------------ Zugang */}
          <div className="card">
            <div className="card-title">SevDesk-Zugang</div>
            <div className="stack">
              <Notice tone="info">
                SevDesk authentifiziert über einen festen API-Token (kein OAuth). Du findest ihn in
                SevDesk unter <strong>Einstellungen → Benutzer → API-Token</strong>. Kontor legt ihn
                im macOS-Schlüsselbund ab — nicht in der Datenbank und nicht in einer Konfigurationsdatei.
              </Notice>

              <div className="row" style={{ alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <Field
                    label="API-Token"
                    hint={tokenHint ? `Hinterlegt: ${tokenHint}` : "Noch kein Token gespeichert"}
                  >
                    <TextInput
                      type="password"
                      value={token}
                      placeholder={tokenHint ? "Neuen Token eintragen zum Ersetzen" : "Token einfügen"}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) => setToken(e.currentTarget.value)}
                    />
                  </Field>
                </div>
                <Button variant="primary" disabled={token.trim() === ""} onClick={saveToken}>
                  Übernehmen
                </Button>
              </div>

              <div className="row">
                <Button busy={testing} disabled={!tokenHint} onClick={testConnection}>
                  Verbindung testen
                </Button>
                {tokenHint ? (
                  <Button variant="danger" onClick={() => setConfirmClear(true)}>
                    Token entfernen
                  </Button>
                ) : null}
                <span className="spacer" />
                {status ? (
                  <span className="row" style={{ gap: 6, fontSize: 12 }}>
                    <Badge tone="success">verbunden</Badge>
                    <span style={{ color: "var(--text-muted)" }}>
                      {status.contactCount} Kontakte · Buchhaltung{" "}
                      {status.bookkeepingVersion ?? "?"} · Steuer via{" "}
                      {status.taxMode === "tax_rule" ? "taxRule" : "taxType"}
                    </span>
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* ------------------------------------------- Rechnungen */}
          <div className="card">
            <div className="card-title">Rechnungsvorgaben</div>
            <div className="stack">
              <div className="grid-2">
                <Field label="Steuersatz (%)">
                  <TextInput
                    inputMode="decimal"
                    value={String(draft.taxRate).replace(".", ",")}
                    onChange={(e) => {
                      const parsed = Number(e.currentTarget.value.replace(",", "."));
                      patch({ taxRate: Number.isFinite(parsed) ? parsed : 0 });
                    }}
                  />
                </Field>
                <Field label="Steuertext">
                  <TextInput
                    value={draft.taxText}
                    onChange={(e) => patch({ taxText: e.currentTarget.value })}
                  />
                </Field>
              </div>

              <Field
                label="Steuerfeld an SevDesk"
                hint="Buchhaltungsversion 1.x erwartet taxType, Version 2.x taxRule. „Automatisch“ fragt das einmalig beim Konto ab."
              >
                <Select
                  value={draft.taxMode}
                  onChange={(e) =>
                    patch({ taxMode: e.currentTarget.value as AppSettings["taxMode"] })
                  }
                >
                  <option value="auto">Automatisch erkennen</option>
                  <option value="tax_type">taxType (Buchhaltung 1.x)</option>
                  <option value="tax_rule">taxRule (Buchhaltung 2.x)</option>
                </Select>
              </Field>

              <div className="grid-2">
                <Field label="taxType" hint="z. B. default, eu, noteu, custom">
                  <TextInput
                    value={draft.taxType}
                    onChange={(e) => patch({ taxType: e.currentTarget.value })}
                  />
                </Field>
                <Field label="taxRule-ID" hint="1 = umsatzsteuerpflichtig, 11 = Kleinunternehmer">
                  <TextInput
                    value={draft.taxRuleId}
                    onChange={(e) => patch({ taxRuleId: e.currentTarget.value })}
                  />
                </Field>
              </div>

              <div className="grid-2">
                <Field label="Zahlungsziel (Tage)">
                  <TextInput
                    inputMode="numeric"
                    value={String(draft.timeToPayDays)}
                    onChange={(e) => {
                      const parsed = Number(e.currentTarget.value);
                      patch({ timeToPayDays: Number.isFinite(parsed) ? parsed : 0 });
                    }}
                  />
                </Field>
                <Field
                  label="Abrechnungstaktung"
                  hint="Rundet jede Position auf das nächste Vielfache auf."
                >
                  <Select
                    value={draft.billingIncrementMinutes}
                    onChange={(e) =>
                      patch({ billingIncrementMinutes: Number(e.currentTarget.value) })
                    }
                  >
                    {INCREMENTS.map((value) => (
                      <option key={value} value={value}>
                        {value === 0 ? "Minutengenau" : `${value} Minuten`}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <Field
                label="Positionsname"
                hint="Platzhalter: {task} für den Aufgabentitel, {customer} für den Kundennamen."
              >
                <TextInput
                  value={draft.positionNameTemplate}
                  onChange={(e) => patch({ positionNameTemplate: e.currentTarget.value })}
                />
              </Field>

              <Field label="Kopftext">
                <TextArea
                  value={draft.invoiceHeadText}
                  onChange={(e) => patch({ invoiceHeadText: e.currentTarget.value })}
                />
              </Field>
              <Field label="Fußtext">
                <TextArea
                  value={draft.invoiceFootText}
                  onChange={(e) => patch({ invoiceFootText: e.currentTarget.value })}
                />
              </Field>
            </div>
          </div>

          {/* ------------------------------------------------ App */}
          <div className="card">
            <div className="card-title">App</div>
            <div className="stack">
              <Checkbox
                label="Wochenüberblick als Mitteilung anzeigen"
                checked={draft.weeklyReportEnabled}
                onChange={(value) => patch({ weeklyReportEnabled: value })}
              />
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: -6 }}>
                Erscheint einmal pro Woche beim ersten Start von Kontor und fasst unabgerechnete
                Zeit sowie überfällige Aufgaben zusammen.
              </div>

              {info ? (
                <Field label="Datenbank">
                  <TextInput readOnly value={info.databasePath} className="mono" />
                </Field>
              ) : null}

              <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                Kontor {info?.version ?? ""} · Alle Daten liegen lokal. Der einzige Netzwerkzugriff
                ist die SevDesk-API.
              </div>
            </div>
          </div>
        </div>
      </div>

      {confirmClear ? (
        <ConfirmDialog
          title="API-Token entfernen?"
          destructive
          confirmLabel="Entfernen"
          message="Der Token wird aus dem Schlüsselbund gelöscht. Rechnungsentwürfe lassen sich danach erst wieder anlegen, wenn ein neuer Token hinterlegt ist."
          onConfirm={clearToken}
          onCancel={() => setConfirmClear(false)}
        />
      ) : null}
    </>
  );
}
