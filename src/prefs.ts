/** Persisted preferences (localStorage). */

export type AppSettings = {
  /** Row keys `${pid}-${port}-${address}` that cannot be killed. */
  protectedRowKeys: string[];
  openScheme: "http" | "https";
  /** Path after host:port, e.g. `/` or `/dashboard` */
  openPath: string;
  /** 0 = off, else seconds */
  autoRefreshSec: number;
  skipKillConfirm: boolean;
};

const KEY = "port-scanner-settings-v1";

export const defaultSettings: AppSettings = {
  protectedRowKeys: [],
  openScheme: "http",
  openPath: "",
  autoRefreshSec: 0,
  skipKillConfirm: false,
};

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return { ...defaultSettings };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaultSettings };
    const p = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...defaultSettings,
      ...p,
      protectedRowKeys: Array.isArray(p.protectedRowKeys)
        ? p.protectedRowKeys.filter((x) => typeof x === "string")
        : defaultSettings.protectedRowKeys,
      openScheme: p.openScheme === "https" ? "https" : "http",
      openPath: typeof p.openPath === "string" ? p.openPath : "",
      autoRefreshSec:
        typeof p.autoRefreshSec === "number" && p.autoRefreshSec >= 0
          ? p.autoRefreshSec
          : 0,
      skipKillConfirm: Boolean(p.skipKillConfirm),
    };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(s: AppSettings) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(s));
}
