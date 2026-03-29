import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

// ── Types ─────────────────────────────────────────────────────────────────

interface PortProcess {
  name: string;
  pid: number;
  port: string;
  address: string;
  project?: string;
  cwd?: string;
  uptime?: string;
}

type KillState = "killing" | "success" | "error";

// ── Uptime utilities ──────────────────────────────────────────────────────

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

/** Map 0–1 ratio to green → yellow → red hex color. */
function ratioColor(ratio: number): string {
  if (ratio < 0.4) return "#00e87e";
  if (ratio < 0.7) return "#ffc043";
  return "#ff3d5a";
}

/** lsof address → human-readable bind string. */
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
    <div className="stat-card" style={{ "--card-color": color, "--card-dim": dim } as React.CSSProperties}>
      <span className="stat-icon">{icon}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

interface ChartProps {
  processes: PortProcess[];
}

function UptimeChart({ processes }: ChartProps) {
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

  // Re-trigger animation whenever the process list changes.
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

// ── Main app ──────────────────────────────────────────────────────────────

function App() {
  const [processes, setProcesses] = useState<PortProcess[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [killStates, setKillStates] = useState<Map<string, KillState>>(new Map());
  const [killErrors, setKillErrors] = useState<Map<string, string>>(new Map());
  const [isAdmin, setIsAdmin] = useState(false);
  const [chartOpen, setChartOpen] = useState(true);

  const rowKey = (p: PortProcess) => `${p.pid}-${p.port}-${p.address}`;

  const scan = useCallback(async (admin = false) => {
    setLoading(true);
    setScanError(null);
    setKillStates(new Map());
    setKillErrors(new Map());
    try {
      const result = await invoke<PortProcess[]>(
        admin ? "list_listeners_admin" : "list_listeners"
      );
      setProcesses(result);
      setIsAdmin(admin);
    } catch (e) {
      setScanError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    scan(false);
  }, [scan]);

  const kill = async (p: PortProcess) => {
    const key = rowKey(p);
    setKillStates((prev) => new Map(prev).set(key, "killing"));
    setKillErrors((prev) => { const n = new Map(prev); n.delete(key); return n; });
    try {
      await invoke("kill_pid", { pid: p.pid });
      setKillStates((prev) => new Map(prev).set(key, "success"));
      setTimeout(() => {
        setProcesses((prev) => prev.filter((x) => rowKey(x) !== key));
        setKillStates((prev) => { const n = new Map(prev); n.delete(key); return n; });
      }, 700);
    } catch (e) {
      setKillStates((prev) => new Map(prev).set(key, "error"));
      setKillErrors((prev) => new Map(prev).set(key, String(e)));
    }
  };

  // ── Stats ────────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const portCount = processes.length;
    const pidCount = new Set(processes.map((p) => p.pid)).size;
    const secs = processes
      .map((p) => parseUptimeSecs(p.uptime))
      .filter((s) => s > 0);
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
  }, [processes]);

  return (
    <div className="app">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="header">
        <div className="header-title">
          <span className="header-dot" />
          <h1>Port Scanner</h1>
          {isAdmin && <span className="admin-badge">admin</span>}
        </div>
        <div className="header-actions">
          <button
            className="btn btn-ghost"
            onClick={() => scan(false)}
            disabled={loading}
            title="Re-scan"
          >
            {loading ? <span className="spinner" /> : "↻ Refresh"}
          </button>
          <button
            className="btn btn-ghost btn-admin"
            onClick={() => scan(true)}
            disabled={loading}
            title="Prompts for admin password"
          >
            Scan as Admin
          </button>
        </div>
      </header>

      {/* ── Stats bar ──────────────────────────────────────────────────── */}
      <div className="stats-bar">
        <StatCard
          icon="◉"
          label="Open Ports"
          value={stats.portCount}
          color="#00e87e"
          dim="rgba(0,232,126,0.1)"
        />
        <div className="stats-divider" />
        <StatCard
          icon="⬡"
          label="Processes"
          value={stats.pidCount}
          color="#3d94ff"
          dim="rgba(61,148,255,0.1)"
        />
        <div className="stats-divider" />
        <StatCard
          icon="∅"
          label="Avg Open"
          value={stats.avg}
          color="#b8cfe8"
          dim="rgba(184,207,232,0.06)"
        />
        <div className="stats-divider" />
        <StatCard
          icon="↑"
          label="Longest"
          value={stats.longest}
          color="#ff3d5a"
          dim="rgba(255,61,90,0.1)"
        />
        <div className="stats-divider" />
        <StatCard
          icon="↓"
          label="Newest"
          value={stats.newest}
          color="#00e87e"
          dim="rgba(0,232,126,0.1)"
        />
      </div>

      {/* ── Content ────────────────────────────────────────────────────── */}
      <div className="content">
        {scanError && (
          <div className="banner banner-error">
            <strong>Scan failed:</strong> {scanError}
          </div>
        )}

        {loading ? (
          <div className="empty-state">
            <div className="spinner large" />
            <p>Scanning for active listeners…</p>
          </div>
        ) : processes.length === 0 ? (
          <div className="empty-state">
            <p className="empty-icon">◎</p>
            <p>No processes found listening on ports.</p>
          </div>
        ) : (
          <>
            {/* ── Chart ────────────────────────────────────────────────── */}
            <div className="chart-section">
              <button
                className="chart-toggle"
                onClick={() => setChartOpen((v) => !v)}
              >
                <span>UPTIME DISTRIBUTION</span>
                <span className="chart-chevron">{chartOpen ? "▲" : "▼"}</span>
              </button>
              {chartOpen && <UptimeChart processes={processes} />}
            </div>

            {/* ── Table ────────────────────────────────────────────────── */}
            <div className="table-wrap">
              <table className="process-table">
                <thead>
                  <tr>
                    <th>Process</th>
                    <th>PID</th>
                    <th>Port</th>
                    <th>Bound to</th>
                    <th>Open</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {processes.map((p) => {
                    const key = rowKey(p);
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
                        <td className="col-port">{p.port}</td>
                        <td className="col-bind" title={p.address}>
                          {formatBind(p.address)}
                        </td>
                        <td className="col-open">{p.uptime ?? "—"}</td>
                        <td className="col-action">
                          {errMsg && (
                            <span className="kill-error-tip" title={errMsg}>⚠</span>
                          )}
                          <button
                            className="btn btn-open"
                            title={`Open http://localhost:${p.port}`}
                            onClick={() =>
                              invoke("open_url", { url: `http://localhost:${p.port}` })
                            }
                          >
                            ↗
                          </button>
                          <button
                            className={`btn btn-kill${ks === "success" ? " btn-kill-done" : ks === "error" ? " btn-kill-failed" : ""}`}
                            onClick={() => kill(p)}
                            disabled={ks === "killing" || ks === "success"}
                          >
                            {ks === "killing" ? "…" : ks === "success" ? "✓" : ks === "error" ? "Retry" : "Kill"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="footer">
        {!loading && (
          <span>
            {processes.length} {processes.length === 1 ? "listener" : "listeners"}
            {isAdmin ? " · admin scan" : ""}
          </span>
        )}
      </footer>
    </div>
  );
}

export default App;
