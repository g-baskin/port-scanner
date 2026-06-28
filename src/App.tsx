import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type AppSettings, loadSettings, saveSettings } from "./prefs";
import "./App.css";

// ── Types ─────────────────────────────────────────────────────────────────

interface PortProcess {
  name: string;
  pid: number;
  port: string;
  address: string;
  command?: string;
  project?: string;
  cwd?: string;
  uptime?: string;
}

interface RunningProcess {
  name: string;
  pid: number;
  command: string;
  project?: string;
  cwd?: string;
  uptime?: string;
  listener_addresses: string[];
}

interface ByteMetrics {
  total_bytes: number;
  used_bytes: number;
  available_bytes: number;
}

interface DiskMetrics extends ByteMetrics {
  mount: string;
}

interface SystemMetrics {
  memory: ByteMetrics;
  disk: DiskMetrics;
  process_count: number;
  listening_process_count: number;
}

type KillState = "killing" | "success" | "error";
type ViewMode = "listeners" | "processes" | "system";
type KillTarget = PortProcess | RunningProcess;

const REPO_URL = "https://github.com/g-baskin/port-scanner";
type SortKey = "process" | "pid" | "port" | "bind" | "open";

// ── Helpers ───────────────────────────────────────────────────────────────

function parseUptimeSecs(uptime: string | undefined): number {
  if (!uptime || uptime === "—") return 0;
  if (uptime === "< 1m") return 30;
  let total = 0;
  const d = uptime.match(/(\d+)d/);
  const h = uptime.match(/(\d+)h/);
  const m = uptime.match(/(\d+)m/);
  if (d) total += parseInt(d[1]) * 86400;
  if (h) total += parseInt(h[1]) * 3600;
  if (m) total += parseInt(m[1]) * 60;
  return total || 30;
}

function secsToLabel(s: number): string {
  if (s < 60) return "< 1m";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

function ratioColor(ratio: number): string {
  if (ratio < 0.4) return "#00e87e";
  if (ratio < 0.7) return "#ffc043";
  return "#ff3d5a";
}

function formatBind(address: string): string {
  const i = address.lastIndexOf(":");
  if (i === -1) return address;
  const host = address.slice(0, i);
  const port = address.slice(i + 1);
  if (host === "*" || host === "0.0.0.0" || host === "::" || host === "[::]")
    return `0.0.0.0:${port}`;
  if (host === "127.0.0.1" || host === "::1" || host === "[::1]")
    return `localhost:${port}`;
  return address;
}

function rowKey(p: PortProcess): string {
  return `${p.pid}-${p.port}-${p.address}`;
}

function processKey(p: Pick<RunningProcess, "pid">): string {
  return `process-${p.pid}`;
}

function killKey(p: KillTarget): string {
  return "port" in p ? rowKey(p) : processKey(p);
}

function compactCommand(command: string | undefined): string {
  if (!command) return "";
  return command.replace(/\s+/g, " ").trim();
}

function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function percentUsed(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 100) : 0;
}

function buildOpenUrl(port: string, s: Pick<AppSettings, "openScheme" | "openPath">): string {
  const path = (s.openPath || "").trim();
  const normalized = path && !path.startsWith("/") ? `/${path}` : path;
  const base = `${s.openScheme}://localhost:${port}`;
  return normalized ? `${base}${normalized}` : base;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function downloadBlob(filename: string, mime: string, body: string) {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows: PortProcess[]): string {
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const header = [
    "name",
    "pid",
    "port",
    "bound",
    "address_raw",
    "command",
    "uptime",
    "project",
    "cwd",
  ];
  const lines = [header.join(",")];
  for (const p of rows) {
    lines.push(
      [
        esc(p.name),
        p.pid,
        esc(p.port),
        esc(formatBind(p.address)),
        esc(p.address),
        esc(p.command ?? ""),
        esc(p.uptime ?? ""),
        esc(p.project ?? ""),
        esc(p.cwd ?? ""),
      ].join(",")
    );
  }
  return lines.join("\n");
}

function processesToCsv(rows: RunningProcess[]): string {
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const header = ["name", "pid", "command", "uptime", "project", "cwd", "listeners"];
  const lines = [header.join(",")];
  for (const p of rows) {
    lines.push(
      [
        esc(p.name),
        p.pid,
        esc(p.command),
        esc(p.uptime ?? ""),
        esc(p.project ?? ""),
        esc(p.cwd ?? ""),
        esc(p.listener_addresses.map(formatBind).join(" ")),
      ].join(",")
    );
  }
  return lines.join("\n");
}

// ── Sub-components ────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string | number;
  color: string;
  dim: string;
  icon: string;
}

function StatCard({ label, value, color, dim, icon }: StatCardProps) {
  return (
    <div
      className="stat-card"
      style={
        { "--card-color": color, "--card-dim": dim } as React.CSSProperties
      }
    >
      <span className="stat-icon">{icon}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function SystemPanel({ metrics }: { metrics: SystemMetrics | null }) {
  if (!metrics) return null;
  const memoryPct = percentUsed(metrics.memory.used_bytes, metrics.memory.total_bytes);
  const diskPct = percentUsed(metrics.disk.used_bytes, metrics.disk.total_bytes);

  return (
    <div className="system-panel">
      <div className="system-card">
        <span className="system-card-label">Memory</span>
        <strong>{formatBytes(metrics.memory.used_bytes)}</strong>
        <span>{formatBytes(metrics.memory.available_bytes)} available of {formatBytes(metrics.memory.total_bytes)}</span>
        <div className="system-meter"><span style={{ width: `${memoryPct}%` }} /></div>
      </div>
      <div className="system-card">
        <span className="system-card-label">Disk {metrics.disk.mount}</span>
        <strong>{formatBytes(metrics.disk.available_bytes)} free</strong>
        <span>{formatBytes(metrics.disk.used_bytes)} used of {formatBytes(metrics.disk.total_bytes)}</span>
        <div className="system-meter system-meter-disk"><span style={{ width: `${diskPct}%` }} /></div>
      </div>
      <div className="system-card">
        <span className="system-card-label">Processes</span>
        <strong>{metrics.process_count}</strong>
        <span>{metrics.listening_process_count} listening on TCP ports</span>
        <div className="system-meter system-meter-process"><span style={{ width: `${Math.min(metrics.listening_process_count * 2, 100)}%` }} /></div>
      </div>
    </div>
  );
}

function UptimeChart({ processes }: { processes: PortProcess[] }) {
  const [animated, setAnimated] = useState(false);
  const prevKey = useRef("");

  const rows = useMemo(
    () =>
      processes
        .filter((p) => p.uptime && p.uptime !== "—")
        .map((p) => ({ ...p, secs: parseUptimeSecs(p.uptime) }))
        .sort((a, b) => b.secs - a.secs),
    [processes]
  );

  const maxSecs = useMemo(() => Math.max(...rows.map((r) => r.secs), 1), [rows]);

  useEffect(() => {
    const key = rows.map((r) => `${r.pid}:${r.secs}`).join(",");
    if (key !== prevKey.current) {
      prevKey.current = key;
      setAnimated(false);
      const t = setTimeout(() => setAnimated(true), 60);
      return () => clearTimeout(t);
    }
  }, [rows]);

  if (rows.length === 0) return null;

  return (
    <div className="chart-rows">
      {rows.map((r) => {
        const pct = (r.secs / maxSecs) * 100;
        const color = ratioColor(r.secs / maxSecs);
        return (
          <div key={`${r.pid}-${r.port}`} className="chart-row">
            <span className="chart-label">
              {r.name}
              <em>:{r.port}</em>
            </span>
            <div className="chart-track">
              <div
                className="chart-bar"
                style={{
                  width: animated ? `${pct}%` : "0%",
                  background: color,
                  boxShadow: `0 0 8px ${color}55`,
                }}
              />
            </div>
            <span className="chart-dur" style={{ color }}>
              {r.uptime}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────

function App() {
  const [processes, setProcesses] = useState<PortProcess[]>([]);
  const [runningProcesses, setRunningProcesses] = useState<RunningProcess[]>([]);
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("listeners");
  const [loading, setLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [killStates, setKillStates] = useState<Map<string, KillState>>(new Map());
  const [killErrors, setKillErrors] = useState<Map<string, string>>(new Map());
  const [isAdmin, setIsAdmin] = useState(false);
  const [chartOpen, setChartOpen] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("port");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filterText, setFilterText] = useState("");
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingKill, setPendingKill] = useState<KillTarget | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [autoPaused, setAutoPaused] = useState(false);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const patchSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const toggleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir("asc");
      return key;
    });
  }, []);

  const sortedProcesses = useMemo(() => {
    const list = [...processes];
    const mul = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "process":
          cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
          break;
        case "pid":
          cmp = a.pid - b.pid;
          break;
        case "port":
          cmp = (parseInt(a.port, 10) || 0) - (parseInt(b.port, 10) || 0);
          break;
        case "bind":
          cmp = formatBind(a.address).localeCompare(formatBind(b.address));
          break;
        case "open":
          cmp = parseUptimeSecs(a.uptime) - parseUptimeSecs(b.uptime);
          break;
        default:
          break;
      }
      if (cmp !== 0) return cmp * mul;
      return a.pid - b.pid || a.port.localeCompare(b.port);
    });
    return list;
  }, [processes, sortKey, sortDir]);

  const q = filterText.trim().toLowerCase();
  const filteredProcesses = useMemo(() => {
    if (!q) return sortedProcesses;
    return sortedProcesses.filter((p) => {
      const hay = [
        p.name,
        String(p.pid),
        p.port,
        formatBind(p.address),
        p.address,
        p.command ?? "",
        p.project ?? "",
        p.cwd ?? "",
        p.uptime ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [sortedProcesses, q]);

  const sortedRunningProcesses = useMemo(
    () =>
      [...runningProcesses].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
        a.pid - b.pid
      ),
    [runningProcesses]
  );

  const filteredRunningProcesses = useMemo(() => {
    if (!q) return sortedRunningProcesses;
    return sortedRunningProcesses.filter((p) => {
      const hay = [
        p.name,
        String(p.pid),
        p.command,
        p.project ?? "",
        p.cwd ?? "",
        p.uptime ?? "",
        p.listener_addresses.map(formatBind).join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [sortedRunningProcesses, q]);

  const scan = useCallback(
    async (admin = false, opts?: { preserveRowState?: boolean }) => {
      const preserve = opts?.preserveRowState ?? false;
      if (!preserve) {
        setKillStates(new Map());
        setKillErrors(new Map());
        setScanError(null);
        setLoading(true);
      }
      try {
        const result = await invoke<PortProcess[]>(
          admin ? "list_listeners_admin" : "list_listeners"
        );
        setProcesses(result);
        setIsAdmin(admin);
        if (!preserve) setScanError(null);
      } catch (e) {
        if (!preserve) setScanError(String(e));
      } finally {
        if (!preserve) setLoading(false);
      }
    },
    []
  );

  const scanRunningProcesses = useCallback(
    async (opts?: { preserveRowState?: boolean }) => {
      const preserve = opts?.preserveRowState ?? false;
      if (!preserve) {
        setKillStates(new Map());
        setKillErrors(new Map());
        setScanError(null);
        setLoading(true);
      }
      try {
        const result = await invoke<RunningProcess[]>("list_processes");
        setRunningProcesses(result);
        if (!preserve) setScanError(null);
      } catch (e) {
        if (!preserve) setScanError(String(e));
      } finally {
        if (!preserve) setLoading(false);
      }
    },
    []
  );

  const scanSystem = useCallback(
    async (opts?: { preserveRowState?: boolean }) => {
      const preserve = opts?.preserveRowState ?? false;
      if (!preserve) {
        setKillStates(new Map());
        setKillErrors(new Map());
        setScanError(null);
        setLoading(true);
      }
      let error: string | null = null;
      const processRowsPromise = invoke<RunningProcess[]>("list_processes").then(
        (rows) => ({ rows, error: null as string | null }),
        (e) => ({ rows: null, error: String(e) })
      );
      try {
        const metrics = await invoke<SystemMetrics>("get_system_metrics");
        setSystemMetrics((prev) => ({
          ...metrics,
          process_count: prev?.process_count ?? runningProcesses.length,
          listening_process_count: prev?.listening_process_count ?? 0,
        }));
      } catch (e) {
        error = String(e);
      }

      const processRowsResult = await processRowsPromise;
      if (processRowsResult.error) {
        error = error ? `${error}; ${processRowsResult.error}` : processRowsResult.error;
      } else if (processRowsResult.rows) {
        const processRows = processRowsResult.rows;
        const listeningCount = processRows.filter((p) => p.listener_addresses.length > 0).length;
        setSystemMetrics((prev) =>
          prev
            ? {
                ...prev,
                process_count: processRows.length,
                listening_process_count: listeningCount,
              }
            : prev
        );
        setRunningProcesses(processRows);
      }

      {
        if (!preserve) {
          setScanError(error);
          setLoading(false);
        }
      }
    },
    [runningProcesses.length]
  );

  useEffect(() => {
    scan(false);
  }, [scan]);

  useEffect(() => {
    if (viewMode === "processes" && runningProcesses.length === 0) {
      scanRunningProcesses();
    }
    if (viewMode === "system" && !systemMetrics) {
      scanSystem();
    }
  }, [runningProcesses.length, scanRunningProcesses, scanSystem, systemMetrics, viewMode]);

  useEffect(() => {
    const sec = settings.autoRefreshSec;
    if (sec <= 0 || autoPaused || loading) return;
    const id = setInterval(() => {
      if (viewMode === "listeners") scan(false, { preserveRowState: true });
      else if (viewMode === "processes") scanRunningProcesses({ preserveRowState: true });
      else scanSystem({ preserveRowState: true });
    }, sec * 1000);
    return () => clearInterval(id);
  }, [settings.autoRefreshSec, autoPaused, loading, scan, scanRunningProcesses, scanSystem, viewMode]);

  const isProtected = useCallback(
    (p: PortProcess) => settings.protectedRowKeys.includes(rowKey(p)),
    [settings.protectedRowKeys]
  );

  const toggleProtect = useCallback((p: PortProcess) => {
    const k = rowKey(p);
    setSettings((prev) => {
      const set = new Set(prev.protectedRowKeys);
      if (set.has(k)) set.delete(k);
      else set.add(k);
      const next = { ...prev, protectedRowKeys: [...set] };
      saveSettings(next);
      return next;
    });
  }, []);

  const runKill = async (p: KillTarget) => {
    const key = killKey(p);
    setKillStates((prev) => new Map(prev).set(key, "killing"));
    setKillErrors((prev) => {
      const n = new Map(prev);
      n.delete(key);
      return n;
    });
    try {
      await invoke("kill_pid", { pid: p.pid });
      setKillStates((prev) => new Map(prev).set(key, "success"));
      setTimeout(() => {
        if ("port" in p) {
          setProcesses((prev) => prev.filter((x) => rowKey(x) !== key));
        } else {
          setRunningProcesses((prev) => prev.filter((x) => x.pid !== p.pid));
          setProcesses((prev) => prev.filter((x) => x.pid !== p.pid));
        }
        setKillStates((prev) => {
          const n = new Map(prev);
          n.delete(key);
          return n;
        });
      }, 700);
    } catch (e) {
      setKillStates((prev) => new Map(prev).set(key, "error"));
      setKillErrors((prev) => new Map(prev).set(key, String(e)));
    }
  };

  const requestKill = (p: KillTarget) => {
    if (settings.skipKillConfirm) void runKill(p);
    else setPendingKill(p);
  };

  const stats = useMemo(() => {
    if (viewMode === "system") {
      return {
        portCount: systemMetrics?.process_count ?? runningProcesses.length,
        pidCount: systemMetrics?.listening_process_count ?? 0,
        avg: formatBytes(systemMetrics?.memory.available_bytes),
        longest: formatBytes(systemMetrics?.disk.available_bytes),
        newest: systemMetrics
          ? `${percentUsed(systemMetrics.memory.used_bytes, systemMetrics.memory.total_bytes)}%`
          : "—",
      };
    }

    const source = viewMode === "listeners" ? processes : runningProcesses;
    const portCount = viewMode === "listeners" ? processes.length : runningProcesses.length;
    const pidCount =
      viewMode === "listeners"
        ? new Set(processes.map((p) => p.pid)).size
        : runningProcesses.filter((p) => p.listener_addresses.length > 0).length;
    const secs = source.map((p) => parseUptimeSecs(p.uptime)).filter((s) => s > 0);
    if (secs.length === 0)
      return { portCount, pidCount, avg: "—", longest: "—", newest: "—" };
    const avg = secs.reduce((a, b) => a + b, 0) / secs.length;
    return {
      portCount,
      pidCount,
      avg: secsToLabel(avg),
      longest: secsToLabel(Math.max(...secs)),
      newest: secsToLabel(Math.min(...secs)),
    };
  }, [processes, runningProcesses, systemMetrics, viewMode]);

  const exportCsv = () => {
    downloadBlob(
      `port-scanner-${viewMode}-${Date.now()}.csv`,
      "text/csv;charset=utf-8",
      viewMode === "listeners"
        ? toCsv(filteredProcesses)
        : processesToCsv(filteredRunningProcesses)
    );
    showToast("Exported CSV");
  };

  const exportJson = () => {
    const body =
      viewMode === "listeners"
        ? filteredProcesses
        : viewMode === "processes"
          ? filteredRunningProcesses
          : { metrics: systemMetrics, processes: filteredRunningProcesses };
    downloadBlob(
      `port-scanner-${viewMode}-${Date.now()}.json`,
      "application/json",
      JSON.stringify(body, null, 2)
    );
    showToast("Exported JSON");
  };

  const copyRowLine = async (p: PortProcess) => {
    const url = buildOpenUrl(p.port, settings);
    const line = [url, p.name, p.pid, p.port, formatBind(p.address), p.command ?? ""]
      .join("\t");
    const ok = await copyText(line);
    showToast(ok ? "Copied row" : "Copy failed");
  };

  const copyProcessLine = async (p: RunningProcess) => {
    const line = [
      p.name,
      p.pid,
      p.uptime ?? "",
      p.project ?? "",
      p.listener_addresses.map(formatBind).join(" "),
      p.command,
    ].join("\t");
    const ok = await copyText(line);
    showToast(ok ? "Copied process" : "Copy failed");
  };

  const refreshCurrent = () => {
    if (viewMode === "listeners") void scan(false);
    else if (viewMode === "processes") void scanRunningProcesses();
    else void scanSystem();
  };

  const hasRows =
    viewMode === "listeners"
      ? processes.length > 0
      : viewMode === "processes"
        ? runningProcesses.length > 0
        : Boolean(systemMetrics) || runningProcesses.length > 0;

  return (
    <div className="app">
      {toast && <div className="toast">{toast}</div>}

      {pendingKill && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setPendingKill(null)}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="kill-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="kill-confirm-title" className="modal-title">
              Kill process?
            </h2>
            <p className="modal-body">
              <strong>{pendingKill.name}</strong> (PID {pendingKill.pid})
              {"port" in pendingKill && (
                <>
                  {" on port "}
                  <strong>{pendingKill.port}</strong>
                </>
              )}
              <br />
              <span className="modal-sub">
                {compactCommand(pendingKill.command) || "This sends SIGKILL — cannot be undone."}
              </span>
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setPendingKill(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-kill"
                onClick={() => {
                  const t = pendingKill;
                  setPendingKill(null);
                  if (t) void runKill(t);
                }}
              >
                Kill
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="modal modal-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="settings-title" className="modal-title">
              Settings
            </h2>
            <div className="settings-grid">
              <label className="settings-field">
                <span>Open in browser</span>
                <select
                  value={settings.openScheme}
                  onChange={(e) =>
                    patchSettings({
                      openScheme: e.target.value as "http" | "https",
                    })
                  }
                >
                  <option value="http">http://</option>
                  <option value="https">https://</option>
                </select>
              </label>
              <label className="settings-field settings-field-span">
                <span>URL path after port (optional)</span>
                <input
                  type="text"
                  value={settings.openPath}
                  onChange={(e) => patchSettings({ openPath: e.target.value })}
                  placeholder="/ or /dashboard"
                />
              </label>
              <label className="settings-field settings-field-check">
                <input
                  type="checkbox"
                  checked={settings.skipKillConfirm}
                  onChange={(e) =>
                    patchSettings({ skipKillConfirm: e.target.checked })
                  }
                />
                <span>Skip kill confirmation dialog</span>
              </label>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setSettingsOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="header">
        <div className="header-title">
          <span className="header-dot" />
          <h1>
            <span className="header-title-main">PORT SCANNER</span>
            <span className="header-title-handle">
              {" - created by "}
              <button
                type="button"
                className="header-repo-link"
                onClick={() => invoke("open_url", { url: REPO_URL })}
                title={`Open ${REPO_URL}`}
              >
                @g-baskin
              </button>
            </span>
          </h1>
          {isAdmin && viewMode === "listeners" && <span className="admin-badge">admin</span>}
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn-ghost"
            title="Preferences"
            onClick={() => setSettingsOpen(true)}
          >
            ⚙
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={refreshCurrent}
            disabled={loading}
            title="Re-scan"
          >
            {loading ? "Refreshing…" : "↻ Refresh"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-admin"
            onClick={() => scan(true)}
            disabled={loading || viewMode !== "listeners"}
            title={viewMode !== "listeners" ? "Admin scan applies to ports" : "Prompts for admin password"}
          >
            Scan as Admin
          </button>
        </div>
      </header>

      <div className="stats-bar">
        <StatCard
          icon="◉"
          label={viewMode === "listeners" ? "Open Ports" : "Running"}
          value={stats.portCount}
          color="#00e87e"
          dim="rgba(0,232,126,0.1)"
        />
        <div className="stats-divider" />
        <StatCard
          icon="⬡"
          label={viewMode === "system" ? "Listening" : viewMode === "listeners" ? "Processes" : "Listening"}
          value={stats.pidCount}
          color="#3d94ff"
          dim="rgba(61,148,255,0.1)"
        />
        <div className="stats-divider" />
        <StatCard
          icon="∅"
          label={viewMode === "system" ? "Memory Free" : viewMode === "listeners" ? "Avg Open" : "Avg Age"}
          value={stats.avg}
          color="#b8cfe8"
          dim="rgba(184,207,232,0.06)"
        />
        <div className="stats-divider" />
        <StatCard
          icon="↑"
          label={viewMode === "system" ? "Disk Free" : "Longest"}
          value={stats.longest}
          color="#ff3d5a"
          dim="rgba(255,61,90,0.1)"
        />
        <div className="stats-divider" />
        <StatCard
          icon="↓"
          label={viewMode === "system" ? "Mem Used" : "Newest"}
          value={stats.newest}
          color="#00e87e"
          dim="rgba(0,232,126,0.1)"
        />
      </div>

      <div className="content">
        {scanError && (
          <div className="banner banner-error">
            <strong>Scan failed:</strong> {scanError}
          </div>
        )}

        {loading && !hasRows ? (
          <div className="empty-state">
            <p className="empty-icon">◌</p>
            <p>{viewMode === "listeners" ? "Scanning for active listeners…" : viewMode === "processes" ? "Scanning running processes…" : "Scanning system resources…"}</p>
          </div>
        ) : !hasRows ? (
          <div className="empty-state">
            <p className="empty-icon">◎</p>
            <p>{viewMode === "listeners" ? "No processes found listening on ports." : viewMode === "processes" ? "No running processes found." : "No system metrics found."}</p>
            <div className="empty-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setViewMode(viewMode === "listeners" ? "processes" : "listeners")}
              >
                Show {viewMode === "listeners" ? "Running Processes" : "Ports"}
              </button>
              {viewMode !== "system" && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setViewMode("system")}
                >
                  Show System
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="toolbar">
              <div className="view-toggle" aria-label="View mode">
                <button
                  type="button"
                  className={`view-toggle-btn${viewMode === "listeners" ? " view-toggle-active" : ""}`}
                  onClick={() => setViewMode("listeners")}
                >
                  Ports
                </button>
                <button
                  type="button"
                  className={`view-toggle-btn${viewMode === "processes" ? " view-toggle-active" : ""}`}
                  onClick={() => setViewMode("processes")}
                >
                  Processes
                </button>
                <button
                  type="button"
                  className={`view-toggle-btn${viewMode === "system" ? " view-toggle-active" : ""}`}
                  onClick={() => setViewMode("system")}
                >
                  System
                </button>
              </div>
              <input
                type="search"
                className="toolbar-filter"
                placeholder={viewMode === "listeners" ? "Filter by name, PID, port, bind…" : "Filter by app, PID, command, folder…"}
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                aria-label={viewMode === "listeners" ? "Filter listeners" : "Filter processes"}
              />
              <div className="toolbar-group">
                <label className="toolbar-label">
                  Auto
                  <select
                    value={settings.autoRefreshSec}
                    onChange={(e) =>
                      patchSettings({
                        autoRefreshSec: Number(e.target.value),
                      })
                    }
                  >
                    <option value={0}>Off</option>
                    <option value={5}>5s</option>
                    <option value={10}>10s</option>
                    <option value={30}>30s</option>
                  </select>
                </label>
                <label className="toolbar-label toolbar-check">
                  <input
                    type="checkbox"
                    checked={autoPaused}
                    onChange={(e) => setAutoPaused(e.target.checked)}
                    disabled={settings.autoRefreshSec <= 0}
                  />
                  Pause
                </label>
              </div>
              <div className="toolbar-group toolbar-export">
                <button
                  type="button"
                  className="btn btn-ghost btn-tiny"
                  onClick={exportCsv}
                >
                  CSV
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-tiny"
                  onClick={exportJson}
                >
                  JSON
                </button>
              </div>
            </div>

            {viewMode === "listeners" && (
              <div className="chart-section">
                <button
                  type="button"
                  className="chart-toggle"
                  onClick={() => setChartOpen((v) => !v)}
                >
                  <span>UPTIME DISTRIBUTION</span>
                  <span className="chart-chevron">{chartOpen ? "▲" : "▼"}</span>
                </button>
                {chartOpen && <UptimeChart processes={processes} />}
              </div>
            )}

            {viewMode === "system" && <SystemPanel metrics={systemMetrics} />}

            <div className="table-wrap">
              {viewMode === "listeners" ? (
              <table className="process-table">
                <thead>
                  <tr>
                    <th className="th-prot" title="Protect from kill">
                      <span className="th-prot-label">🛡</span>
                    </th>
                    <th className="col-sort">
                      <button
                        type="button"
                        className={`th-sort${sortKey === "process" ? " th-sort-active" : ""}`}
                        onClick={() => toggleSort("process")}
                      >
                        Process
                        {sortKey === "process" ? (
                          <span className="th-sort-arrow">
                            {sortDir === "asc" ? "▲" : "▼"}
                          </span>
                        ) : (
                          <span className="th-sort-dim" aria-hidden>
                            ⇅
                          </span>
                        )}
                      </button>
                    </th>
                    <th className="col-sort">
                      <button
                        type="button"
                        className={`th-sort${sortKey === "pid" ? " th-sort-active" : ""}`}
                        onClick={() => toggleSort("pid")}
                      >
                        PID
                        {sortKey === "pid" ? (
                          <span className="th-sort-arrow">
                            {sortDir === "asc" ? "▲" : "▼"}
                          </span>
                        ) : (
                          <span className="th-sort-dim" aria-hidden>
                            ⇅
                          </span>
                        )}
                      </button>
                    </th>
                    <th className="col-sort">
                      <button
                        type="button"
                        className={`th-sort${sortKey === "port" ? " th-sort-active" : ""}`}
                        onClick={() => toggleSort("port")}
                      >
                        Port
                        {sortKey === "port" ? (
                          <span className="th-sort-arrow">
                            {sortDir === "asc" ? "▲" : "▼"}
                          </span>
                        ) : (
                          <span className="th-sort-dim" aria-hidden>
                            ⇅
                          </span>
                        )}
                      </button>
                    </th>
                    <th className="col-sort">
                      <button
                        type="button"
                        className={`th-sort${sortKey === "bind" ? " th-sort-active" : ""}`}
                        onClick={() => toggleSort("bind")}
                      >
                        Bound to
                        {sortKey === "bind" ? (
                          <span className="th-sort-arrow">
                            {sortDir === "asc" ? "▲" : "▼"}
                          </span>
                        ) : (
                          <span className="th-sort-dim" aria-hidden>
                            ⇅
                          </span>
                        )}
                      </button>
                    </th>
                    <th className="col-sort">
                      <button
                        type="button"
                        className={`th-sort${sortKey === "open" ? " th-sort-active" : ""}`}
                        onClick={() => toggleSort("open")}
                      >
                        Open
                        {sortKey === "open" ? (
                          <span className="th-sort-arrow">
                            {sortDir === "asc" ? "▲" : "▼"}
                          </span>
                        ) : (
                          <span className="th-sort-dim" aria-hidden>
                            ⇅
                          </span>
                        )}
                      </button>
                    </th>
                    <th className="th-actions" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {filteredProcesses.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="td-empty-filter">
                        No rows match your filter.
                      </td>
                    </tr>
                  ) : (
                    filteredProcesses.map((p) => {
                      const key = rowKey(p);
                      const ks = killStates.get(key);
                      const errMsg = killErrors.get(key);
                      const prot = isProtected(p);
                      const openUrl = buildOpenUrl(p.port, settings);
                      return (
                        <tr
                          key={key}
                          className={
                            prot
                              ? "row row-protected"
                              : ks === "success"
                                ? "row row-success"
                                : ks === "error"
                                  ? "row row-error"
                                  : "row"
                          }
                        >
                          <td className="col-prot">
                            <button
                              type="button"
                              className={`btn-prot${prot ? " btn-prot-on" : ""}`}
                              title={
                                prot
                                  ? "Unprotect — allow Kill"
                                  : "Protect — block Kill"
                              }
                              onClick={() => toggleProtect(p)}
                            >
                              {prot ? "🛡" : "○"}
                            </button>
                          </td>
                          <td className="col-name">
                            <span className="col-name-text">{p.name}</span>
                            {p.project && (
                              <span className="col-name-project" title={p.cwd}>
                                {p.project}
                              </span>
                            )}
                            {p.command && (
                              <span className="col-name-command" title={p.command}>
                                {compactCommand(p.command)}
                              </span>
                            )}
                          </td>
                          <td className="col-pid">{p.pid}</td>
                          <td className="col-port">{p.port}</td>
                          <td className="col-bind" title={p.address}>
                            {formatBind(p.address)}
                          </td>
                          <td className="col-open">{p.uptime ?? "—"}</td>
                          <td className="col-action">
                            {errMsg && (
                              <span className="kill-error-tip" title={errMsg}>
                                ⚠
                              </span>
                            )}
                            <button
                              type="button"
                              className="btn btn-copy"
                              title="Copy URL + row (tab-separated)"
                              onClick={() => void copyRowLine(p)}
                            >
                              ⧉
                            </button>
                            <button
                              type="button"
                              className="btn btn-open"
                              title={`Open ${openUrl}`}
                              onClick={() =>
                                invoke("open_url", { url: openUrl })
                              }
                            >
                              ↗
                            </button>
                            <button
                              type="button"
                              className={`btn btn-kill${ks === "success" ? " btn-kill-done" : ks === "error" ? " btn-kill-failed" : ""}`}
                              onClick={() => requestKill(p)}
                              disabled={
                                ks === "killing" ||
                                ks === "success" ||
                                prot
                              }
                              title={
                                prot
                                  ? "Protected — click 🛡 to allow kill"
                                  : undefined
                              }
                            >
                              {ks === "killing"
                                ? "…"
                                : ks === "success"
                                  ? "✓"
                                  : ks === "error"
                                    ? "Retry"
                                    : prot
                                      ? "—"
                                      : "Kill"}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              ) : (
              <table className="process-table">
                <thead>
                  <tr>
                    <th>Process</th>
                    <th>PID</th>
                    <th>Command</th>
                    <th>Open</th>
                    <th>Listeners</th>
                    <th className="th-actions" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {filteredRunningProcesses.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="td-empty-filter">
                        No processes match your filter.
                      </td>
                    </tr>
                  ) : (
                    filteredRunningProcesses.map((p) => {
                      const key = processKey(p);
                      const ks = killStates.get(key);
                      const errMsg = killErrors.get(key);
                      return (
                        <tr
                          key={key}
                          className={
                            ks === "success"
                              ? "row row-success"
                              : ks === "error"
                                ? "row row-error"
                                : "row"
                          }
                        >
                          <td className="col-name">
                            <span className="col-name-text">{p.name}</span>
                            {p.project && (
                              <span className="col-name-project" title={p.cwd}>
                                {p.project}
                              </span>
                            )}
                          </td>
                          <td className="col-pid">{p.pid}</td>
                          <td className="col-command" title={p.command}>
                            {compactCommand(p.command)}
                          </td>
                          <td className="col-open">{p.uptime ?? "—"}</td>
                          <td className="col-listeners">
                            {p.listener_addresses.length > 0
                              ? p.listener_addresses.map(formatBind).join(", ")
                              : "—"}
                          </td>
                          <td className="col-action">
                            {errMsg && (
                              <span className="kill-error-tip" title={errMsg}>
                                ⚠
                              </span>
                            )}
                            <button
                              type="button"
                              className="btn btn-copy"
                              title="Copy process row (tab-separated)"
                              onClick={() => void copyProcessLine(p)}
                            >
                              ⧉
                            </button>
                            <button
                              type="button"
                              className={`btn btn-kill${ks === "success" ? " btn-kill-done" : ks === "error" ? " btn-kill-failed" : ""}`}
                              onClick={() => requestKill(p)}
                              disabled={ks === "killing" || ks === "success"}
                            >
                              {ks === "killing"
                                ? "…"
                                : ks === "success"
                                  ? "✓"
                                  : ks === "error"
                                    ? "Retry"
                                    : "Kill"}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              )}
            </div>
          </>
        )}
      </div>

      <footer className="footer">
        <span>
          {loading ? "Scanning…" : (
            <>
              {viewMode === "listeners"
                ? q
                  ? `Showing ${filteredProcesses.length} of ${processes.length} listeners`
                  : `${processes.length} ${processes.length === 1 ? "listener" : "listeners"}`
                : q
                  ? `Showing ${filteredRunningProcesses.length} of ${runningProcesses.length} processes`
                  : `${runningProcesses.length} ${runningProcesses.length === 1 ? "process" : "processes"}`}
              {isAdmin && viewMode === "listeners" ? " · admin scan" : ""}
              {settings.autoRefreshSec > 0 && !autoPaused
                ? ` · auto ${settings.autoRefreshSec}s`
                : ""}
            </>
          )}
        </span>
      </footer>
    </div>
  );
}

export default App;
