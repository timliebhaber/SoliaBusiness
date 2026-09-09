import { useEffect } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { api } from "../lib/api";
import { formatCents, formatDuration, startOfWeek, isoDate } from "../lib/format";
import type { AppSettings } from "../lib/types";

const STORAGE_KEY = "kontor.weeklyReport.lastShown";

/**
 * Wochenüberblick als Systemmitteilung. Bewusst beim Start der App statt als
 * Hintergrunddienst — eine geschlossene App kann keine Erinnerung senden, und
 * so etwas vorzutäuschen wäre unehrlich.
 */
export function useWeeklyReport(settings: AppSettings | null) {
  useEffect(() => {
    if (!settings?.weeklyReportEnabled) return;

    const weekKey = isoDate(startOfWeek());
    if (window.localStorage.getItem(STORAGE_KEY) === weekKey) return;

    let cancelled = false;
    (async () => {
      try {
        const dashboard = await api.dashboard();
        if (cancelled) return;
        if (dashboard.unbilledMinutes === 0 && dashboard.overdue.length === 0) return;

        let granted = await isPermissionGranted();
        if (!granted) granted = (await requestPermission()) === "granted";
        if (!granted || cancelled) return;

        const parts = [
          `${formatDuration(dashboard.unbilledMinutes)} unabgerechnet`,
          dashboard.unbilledCents > 0 ? `≈ ${formatCents(dashboard.unbilledCents)}` : null,
          dashboard.overdue.length > 0
            ? `${dashboard.overdue.length} überfällige Aufgaben`
            : null,
        ].filter(Boolean);

        sendNotification({ title: "Kontor — Wochenüberblick", body: parts.join(" · ") });
        window.localStorage.setItem(STORAGE_KEY, weekKey);
      } catch {
        // Eine fehlgeschlagene Erinnerung darf den Start nicht stören.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [settings?.weeklyReportEnabled]);
}
