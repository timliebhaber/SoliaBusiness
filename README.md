# SoliaBusiness

Native macOS-App für Freelancer: Kundenverwaltung, aufgabenbasiertes To-Do-Tracking,
Zeiterfassung und Rechnungsentwürfe über die SevDesk-API.

Offline-first — alle Daten liegen lokal in SQLite. Der einzige Netzwerkzugriff ist SevDesk.

## Stack

| Ebene      | Technik |
|------------|---------|
| Shell      | Tauri 2 (`.app`-Bundle, Dock- und Menüleisten-Icon) |
| Frontend   | React 19 + TypeScript (strict) + Vite |
| Backend    | Rust — SQLite (rusqlite, gebündelt), Keychain, HTTP |
| Datenbank  | SQLite mit WAL unter `~/Library/Application Support/de.solia.soliabusiness/soliabusiness.sqlite3` |
| Geheimnis  | SevDesk-Token im macOS-Schlüsselbund (`de.solia.soliabusiness` / `sevdesk-api-token`) |

## Entwicklung

Voraussetzungen: Node ≥ 20, Rust ≥ 1.85 (`rustup`), Xcode Command Line Tools.

```bash
npm install
npm run app:dev      # Tauri-Dev-Fenster mit Hot Reload
npm run typecheck    # tsc --noEmit
npm run app:build    # .app + .dmg unter src-tauri/target/release/bundle/
```

Ist Rust über `rustup` ohne PATH-Eintrag installiert, vorher einmal:

```bash
echo '. "$HOME/.cargo/env"' >> ~/.zprofile
```

## Datenmodell

Vier Tabellen plus `settings` und ein Rechnungs-Audit (`invoices`, `invoice_items`).
Migrationen laufen über `PRAGMA user_version`, jede genau einmal, in einer Transaktion.

Zwei bewusste Abweichungen von der Spezifikation, beide aus demselben Grund —
Geld und Zeit werden nicht als Fließkommazahl gespeichert:

* `hourly_rate_cents INTEGER` statt `hourly_rate Decimal`
* `estimated_minutes INTEGER` statt `estimated_hours Decimal`

Umgerechnet wird erst bei der Anzeige und beim Rechnungsaufbau.

### Robustheit bei Absturz

* Der laufende Timer ist eine Zeile in `time_entries` mit `end_time IS NULL` —
  kein React-State. Nach einem Absturz liest die App ihn beim Start wieder ein.
* Ein partieller Unique-Index erzwingt datenbankseitig **höchstens einen** laufenden Timer.
* `duration_minutes` wird redundant gespeichert; ein CHECK-Constraint erzwingt, dass
  `end_time` und `duration_minutes` nur gemeinsam gesetzt sind.
* Referenzintegrität: Kunden werden archiviert, nicht gelöscht (`ON DELETE RESTRICT`).
  Wird eine Aufgabe gelöscht, bleiben ihre Zeiten erhalten (`ON DELETE SET NULL`).

## SevDesk

**Auth-Flow:** SevDesk nutzt einen statischen API-Token, kein OAuth. Der Token wandert
unverändert in den `Authorization`-Header. Zu finden in SevDesk unter
*Einstellungen → Benutzer → API-Token*. SoliaBusiness legt ihn im Schlüsselbund ab; er erreicht
weder die SQLite-Datei noch das Frontend — die UI sieht nur die letzten vier Zeichen.

**Was passiert beim Rechnungslauf**

1. Lokale Vorschau: alle `invoiced = 0`-Zeiteinträge des Kunden, gruppiert nach Aufgabe.
   Je Gruppe eine Rechnungsposition, Menge = Stunden, Preis = Stundensatz des Kunden.
   Die Notizen der Einträge werden zum Positionstext.
2. `POST /Invoice/Factory/saveInvoice` mit `status: "100"` — **Entwurf**. Es wird nichts versendet.
3. Erst nach bestätigter Antwort werden Zeiteinträge und Aufgaben in **einer** Transaktion
   als abgerechnet markiert und ein Rechnungssatz protokolliert.

**Fehlerverhalten**

* 429/503 → Wiederholung mit exponentiellem Backoff, `Retry-After` wird beachtet.
* Verbindungsfehler (Anfrage nie abgeschickt) → Wiederholung.
* Timeout *nach* dem Absenden eines POST → **keine** Wiederholung, stattdessen der Hinweis,
  in SevDesk nachzusehen. Eine doppelte Rechnung wäre schlimmer als ein Abbruch.
* Scheitert das lokale Markieren, obwohl der Entwurf steht, meldet die App das mit
  Rechnungsnummer — statt stillschweigend einen halben Zustand zu hinterlassen.

**Steuerfelder:** Buchhaltungsversion 1.x erwartet `taxType`, 2.x `taxRule`. SoliaBusiness erkennt
das über `/Tools/bookkeepingSystemVersion`; in den Einstellungen lässt es sich überschreiben.
Ebenso Steuersatz, Steuertext, Zahlungsziel, Kopf-/Fußtext und die Abrechnungstaktung.

**Bewusst nicht automatisch abgerechnet:** erledigte Aufgaben ohne offene Zeit. Sie
erzeugen keine Position und bleiben deshalb auf „nicht abgerechnet“ stehen — die App
zeigt sie in der Vorschau an, die Checkbox setzt du selbst.

## Menüleiste

Neben dem Dock-Icon läuft ein Menüleisten-Symbol mit der laufenden Zeit als Titel.
Darüber lässt sich der Timer für die zuletzt genutzten Kunden starten. „Stoppen“ holt
das Fenster nach vorn, weil die Notiz beim Stoppen Pflicht ist.

Das Schließen des Fensters beendet die App nicht — der Timer läuft in der Menüleiste
weiter. Beenden über das Menüleisten-Symbol oder ⌘Q.

## Export

CSV-Export der gefilterten Zeiteinträge: Semikolon-getrennt mit BOM und deutscher
Dezimalschreibweise, damit Excel und Numbers die Datei ohne Import-Dialog öffnen.
Enthält Stundensatz und Betrag je Zeile — unabhängig von SevDesk nutzbar.

## Struktur

```
src/                     React-Oberfläche
  lib/       api.ts (typisierte invoke-Hülle), types.ts, format.ts, store.tsx, toast.tsx
  components/            Timer, Aufgaben, Zeit-Tabelle, Rechnungs-Panel, UI-Bausteine
  views/                 Dashboard, Kunden, Zeiten, Rechnungen, Einstellungen
src-tauri/src/
  db/                    Verbindung, Pragmas, Migrationen
  commands/              Kunden, Aufgaben, Zeit, Dashboard, Export, Einstellungen, Abrechnung
  sevdesk/               HTTP-Client mit Retry und Fehlerübersetzung
  error.rs               ein Fehlertyp, als {kind, message, retryable} ins Frontend
  keychain.rs            Schlüsselbund-Zugriff
  tray.rs                Menüleisten-Symbol und -Menü
```
