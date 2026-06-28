// SPDX-License-Identifier: GPL-3.0-or-later
// Port Scanner — see LICENSE and NOTICE in the repository root.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PortProcess {
    pub name: String,
    pub pid: u32,
    pub port: String,
    pub address: String,
    /// Full command line, used to distinguish generic runtimes like node/bun.
    pub command: Option<String>,
    /// Basename of the process's working directory (the "project folder").
    pub project: Option<String>,
    /// Full path to the working directory, used as a tooltip in the UI.
    pub cwd: Option<String>,
    /// Human-readable time the process has been running, e.g. "2h 34m".
    pub uptime: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RunningProcess {
    pub name: String,
    pub pid: u32,
    pub command: String,
    pub project: Option<String>,
    pub cwd: Option<String>,
    pub uptime: Option<String>,
    /// Listener addresses owned by this PID, e.g. localhost:3000 or *:5173.
    pub listener_addresses: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MemoryMetrics {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiskMetrics {
    pub mount: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SystemMetrics {
    pub memory: MemoryMetrics,
    pub disk: DiskMetrics,
    pub process_count: usize,
    /// Filled by the UI from list_processes to avoid a second listener scan.
    pub listening_process_count: usize,
}

pub struct KnownPids(Mutex<HashSet<u32>>);

// ── lsof TCP listener parser ──────────────────────────────────────────────

/// Parse `lsof -n -P -iTCP -sTCP:LISTEN` output.
///
/// Typical line (whitespace-split):
///   COMMAND  PID  USER  FD  TYPE  DEVICE  SIZE/OFF  NODE  NAME  (STATE)
///   node    1234  user  23u IPv4  0x...   0t0       TCP   *:3000 (LISTEN)
///
/// Field indices: 0=command  1=pid  8=address(*:port)
fn parse_lsof(output: &str) -> Vec<PortProcess> {
    let mut seen: HashSet<(u32, String, String)> = HashSet::new();
    let mut results = Vec::new();

    for line in output.lines() {
        if line.starts_with("COMMAND") {
            continue;
        }
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 9 {
            continue;
        }
        let name = fields[0].to_string();
        let pid: u32 = match fields[1].parse() {
            Ok(p) => p,
            Err(_) => continue,
        };
        let address = fields[8].to_string();
        let port = address.rsplit(':').next().unwrap_or("?").to_string();

        if seen.insert((pid, port.clone(), address.clone())) {
            results.push(PortProcess {
                name,
                pid,
                port,
                address,
                command: None,
                project: None,
                cwd: None,
                uptime: None,
            });
        }
    }

    results.sort_by(|a, b| {
        let pa: u32 = a.port.parse().unwrap_or(0);
        let pb: u32 = b.port.parse().unwrap_or(0);
        pa.cmp(&pb)
    });

    results
}

// ── Working-directory lookup ──────────────────────────────────────────────

/// Run `lsof -Fn -d cwd -p <pid1,pid2,...>` and return a pid→full-path map.
///
/// lsof machine-readable output with -F fields looks like:
///   p12345    ← process PID
///   fcwd      ← file descriptor type
///   n/path    ← name (the path we want)
fn get_cwds(pids: &[u32]) -> HashMap<u32, String> {
    if pids.is_empty() {
        return HashMap::new();
    }
    let pid_arg = pids
        .iter()
        .map(|p| p.to_string())
        .collect::<Vec<_>>()
        .join(",");

    let Ok(output) = std::process::Command::new("lsof")
        .args(["-Fn", "-d", "cwd", "-p", &pid_arg])
        .output()
    else {
        return HashMap::new();
    };

    parse_cwds(&String::from_utf8_lossy(&output.stdout))
}

fn get_cwds_chunked(pids: &[u32]) -> HashMap<u32, String> {
    let mut map = HashMap::new();
    for chunk in pids.chunks(100) {
        map.extend(get_cwds(chunk));
    }
    map
}

fn parse_cwds(output: &str) -> HashMap<u32, String> {
    let mut map = HashMap::new();
    let mut current_pid: Option<u32> = None;
    let mut expect_name = false;

    for line in output.lines() {
        if let Some(rest) = line.strip_prefix('p') {
            current_pid = rest.parse().ok();
            expect_name = false;
        } else if line.starts_with('f') {
            // With -d cwd every 'f' record is the cwd fd; next 'n' is our path.
            expect_name = true;
        } else if expect_name {
            if let Some(path) = line.strip_prefix('n') {
                if let Some(pid) = current_pid {
                    // Skip bare "/" — not a useful project indicator.
                    if path.len() > 1 {
                        map.insert(pid, path.to_string());
                    }
                }
            }
            expect_name = false;
        }
    }

    map
}

/// Return the last path component of a full directory path.
fn basename(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
        .to_string()
}

/// Attach cwd/project data from a pid→path map into process records.
fn attach_cwds(processes: &mut [PortProcess], cwds: HashMap<u32, String>) {
    for p in processes.iter_mut() {
        if let Some(path) = cwds.get(&p.pid) {
            p.project = Some(basename(path));
            p.cwd = Some(path.clone());
        }
    }
}

// ── Process uptime ────────────────────────────────────────────────────────

/// Run `ps -ax -o pid=,etime=` (all processes, machine-readable) and return
/// a pid→formatted-duration map for the requested PIDs.
///
/// `etime` format from ps: [[DD-]HH:]MM:SS
fn get_uptimes(pids: &[u32]) -> HashMap<u32, String> {
    if pids.is_empty() {
        return HashMap::new();
    }
    let pid_set: HashSet<u32> = pids.iter().copied().collect();

    let Ok(output) = std::process::Command::new("ps")
        .args(["-ax", "-o", "pid=,etime="])
        .output()
    else {
        return HashMap::new();
    };

    let mut map = HashMap::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }
        let Ok(pid) = parts[0].parse::<u32>() else {
            continue;
        };
        if pid_set.contains(&pid) {
            map.insert(pid, format_etime(parts[1]));
        }
    }
    map
}

/// Convert ps `etime` (`[[DD-]HH:]MM:SS`) to a compact human label.
fn format_etime(etime: &str) -> String {
    let (days, rest) = match etime.split_once('-') {
        Some((d, r)) => (d.parse::<u64>().unwrap_or(0), r),
        None => (0, etime),
    };

    let segments: Vec<u64> = rest.split(':').filter_map(|s| s.parse().ok()).collect();

    let (hours, minutes, _seconds) = match segments.as_slice() {
        [h, m, s] => (*h, *m, *s),
        [m, s] => (0, *m, *s),
        [s] => (0, 0, *s),
        _ => (0, 0, 0),
    };

    if days > 0 {
        if hours > 0 {
            format!("{}d {}h", days, hours)
        } else {
            format!("{}d", days)
        }
    } else if hours > 0 {
        if minutes > 0 {
            format!("{}h {}m", hours, minutes)
        } else {
            format!("{}h", hours)
        }
    } else if minutes > 0 {
        format!("{}m", minutes)
    } else {
        "< 1m".to_string()
    }
}

/// Attach uptime strings into process records.
fn attach_uptimes(processes: &mut [PortProcess], uptimes: HashMap<u32, String>) {
    for p in processes.iter_mut() {
        if let Some(t) = uptimes.get(&p.pid) {
            p.uptime = Some(t.clone());
        }
    }
}

// ── Process command lines / full process list ──────────────────────────────

fn process_name_from_command(command: &str) -> String {
    let first = command.split_whitespace().next().unwrap_or(command);
    std::path::Path::new(first)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(first)
        .to_string()
}

fn get_commands(pids: &[u32]) -> HashMap<u32, String> {
    if pids.is_empty() {
        return HashMap::new();
    }
    let pid_set: HashSet<u32> = pids.iter().copied().collect();

    let Ok(output) = std::process::Command::new("ps")
        .args(["-axww", "-o", "pid=,command="])
        .output()
    else {
        return HashMap::new();
    };

    let mut map = HashMap::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let mut parts = line.trim().splitn(2, char::is_whitespace);
        let Some(pid_raw) = parts.next() else {
            continue;
        };
        let Ok(pid) = pid_raw.parse::<u32>() else {
            continue;
        };
        if !pid_set.contains(&pid) {
            continue;
        }
        if let Some(command) = parts.next() {
            let command = command.trim();
            if !command.is_empty() {
                map.insert(pid, command.to_string());
            }
        }
    }
    map
}

fn attach_commands(processes: &mut [PortProcess], commands: HashMap<u32, String>) {
    for p in processes.iter_mut() {
        if let Some(command) = commands.get(&p.pid) {
            p.command = Some(command.clone());
        }
    }
}

fn parse_processes(output: &str) -> Vec<RunningProcess> {
    let mut results = Vec::new();

    for line in output.lines() {
        let mut parts = line.trim().splitn(3, char::is_whitespace);
        let Some(pid_raw) = parts.next() else {
            continue;
        };
        let Some(etime) = parts.next() else { continue };
        let Some(command) = parts.next() else {
            continue;
        };
        let Ok(pid) = pid_raw.parse::<u32>() else {
            continue;
        };
        let command = command.trim();
        if command.is_empty() {
            continue;
        }

        results.push(RunningProcess {
            name: process_name_from_command(command),
            pid,
            command: command.to_string(),
            project: None,
            cwd: None,
            uptime: Some(format_etime(etime)),
            listener_addresses: Vec::new(),
        });
    }

    results.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.pid.cmp(&b.pid)));
    results
}

fn attach_process_cwds(processes: &mut [RunningProcess], cwds: HashMap<u32, String>) {
    for p in processes.iter_mut() {
        if let Some(path) = cwds.get(&p.pid) {
            p.project = Some(basename(path));
            p.cwd = Some(path.clone());
        }
    }
}

fn attach_listener_addresses(processes: &mut [RunningProcess]) {
    let Ok(output) = std::process::Command::new("lsof")
        .args(["-n", "-P", "-iTCP", "-sTCP:LISTEN"])
        .output()
    else {
        return;
    };

    let listeners = parse_lsof(&String::from_utf8_lossy(&output.stdout));
    let mut by_pid: HashMap<u32, Vec<String>> = HashMap::new();
    for listener in listeners {
        by_pid
            .entry(listener.pid)
            .or_default()
            .push(listener.address);
    }

    for p in processes.iter_mut() {
        if let Some(addresses) = by_pid.get(&p.pid) {
            p.listener_addresses = addresses.clone();
            p.listener_addresses.sort();
            p.listener_addresses.dedup();
        }
    }
}

fn needs_cwd_lookup(p: &RunningProcess) -> bool {
    if !p.listener_addresses.is_empty() {
        return true;
    }

    matches!(
        p.name.as_str(),
        "node"
            | "bun"
            | "deno"
            | "npm"
            | "pnpm"
            | "yarn"
            | "vite"
            | "python"
            | "python3"
            | "uvicorn"
            | "ruby"
            | "rails"
            | "cargo"
    )
}

// ── System resource metrics ────────────────────────────────────────────────

fn parse_u64_token(raw: &str) -> Option<u64> {
    raw.trim_matches(|c: char| !c.is_ascii_digit()).parse().ok()
}

fn get_memory_metrics() -> Result<MemoryMetrics, String> {
    let total_output = std::process::Command::new("sysctl")
        .args(["-n", "hw.memsize"])
        .output()
        .map_err(|e| format!("Failed to run sysctl: {e}"))?;
    let total_bytes = String::from_utf8_lossy(&total_output.stdout)
        .trim()
        .parse::<u64>()
        .map_err(|e| format!("Failed to parse total memory: {e}"))?;

    let vm_output = std::process::Command::new("vm_stat")
        .output()
        .map_err(|e| format!("Failed to run vm_stat: {e}"))?;
    let vm = String::from_utf8_lossy(&vm_output.stdout);
    let page_size = vm
        .lines()
        .find(|line| line.contains("page size of"))
        .and_then(|line| line.split("page size of").nth(1))
        .and_then(parse_u64_token)
        .unwrap_or(4096);

    let mut free_pages = 0;
    let mut inactive_pages = 0;
    let mut speculative_pages = 0;
    for line in vm.lines() {
        if let Some((label, value)) = line.split_once(':') {
            let pages = parse_u64_token(value).unwrap_or(0);
            match label.trim() {
                "Pages free" => free_pages = pages,
                "Pages inactive" => inactive_pages = pages,
                "Pages speculative" => speculative_pages = pages,
                _ => {}
            }
        }
    }

    let available_bytes = (free_pages + inactive_pages + speculative_pages) * page_size;
    let used_bytes = total_bytes.saturating_sub(available_bytes);
    Ok(MemoryMetrics {
        total_bytes,
        used_bytes,
        available_bytes,
    })
}

fn get_disk_metrics() -> Result<DiskMetrics, String> {
    let output = std::process::Command::new("df")
        .args(["-k", "/"])
        .output()
        .map_err(|e| format!("Failed to run df: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout
        .lines()
        .nth(1)
        .ok_or_else(|| "Failed to parse disk metrics".to_string())?;
    let fields: Vec<&str> = line.split_whitespace().collect();
    if fields.len() < 6 {
        return Err("Failed to parse disk metrics".to_string());
    }

    let total_bytes = fields[1]
        .parse::<u64>()
        .map_err(|e| format!("Failed to parse disk total: {e}"))?
        * 1024;
    let used_bytes = fields[2]
        .parse::<u64>()
        .map_err(|e| format!("Failed to parse disk used: {e}"))?
        * 1024;
    let available_bytes = fields[3]
        .parse::<u64>()
        .map_err(|e| format!("Failed to parse disk available: {e}"))?
        * 1024;
    let mount = fields.last().copied().unwrap_or("/").to_string();

    Ok(DiskMetrics {
        mount,
        total_bytes,
        used_bytes,
        available_bytes,
    })
}

// ── Tauri commands ────────────────────────────────────────────────────────

#[tauri::command]
fn list_listeners(state: State<KnownPids>) -> Result<Vec<PortProcess>, String> {
    let output = std::process::Command::new("lsof")
        .args(["-n", "-P", "-iTCP", "-sTCP:LISTEN"])
        .output()
        .map_err(|e| format!("Failed to run lsof: {e}"))?;

    let mut processes = parse_lsof(&String::from_utf8_lossy(&output.stdout));

    let pids: Vec<u32> = processes.iter().map(|p| p.pid).collect();
    attach_cwds(&mut processes, get_cwds_chunked(&pids));
    attach_uptimes(&mut processes, get_uptimes(&pids));
    attach_commands(&mut processes, get_commands(&pids));

    *state.0.lock().unwrap() = processes.iter().map(|p| p.pid).collect();
    Ok(processes)
}

/// Uses osascript to run lsof with a one-time administrator privileges prompt.
#[tauri::command]
fn list_listeners_admin(state: State<KnownPids>) -> Result<Vec<PortProcess>, String> {
    let script = r#"do shell script "lsof -n -P -iTCP -sTCP:LISTEN" with administrator privileges"#;

    let output = std::process::Command::new("osascript")
        .args(["-e", script])
        .output()
        .map_err(|e| format!("Failed to run osascript: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Admin scan failed or was cancelled. {}",
            stderr.trim()
        ));
    }

    let mut processes = parse_lsof(&String::from_utf8_lossy(&output.stdout));

    // CWD lookup runs as the current user; system PIDs simply get no project label.
    let pids: Vec<u32> = processes.iter().map(|p| p.pid).collect();
    attach_cwds(&mut processes, get_cwds_chunked(&pids));
    attach_uptimes(&mut processes, get_uptimes(&pids));
    attach_commands(&mut processes, get_commands(&pids));

    *state.0.lock().unwrap() = processes.iter().map(|p| p.pid).collect();
    Ok(processes)
}

#[tauri::command]
fn list_processes(state: State<KnownPids>) -> Result<Vec<RunningProcess>, String> {
    let output = std::process::Command::new("ps")
        .args(["-axww", "-o", "pid=,etime=,command="])
        .output()
        .map_err(|e| format!("Failed to run ps: {e}"))?;

    let mut processes = parse_processes(&String::from_utf8_lossy(&output.stdout));
    attach_listener_addresses(&mut processes);

    let cwd_pids: Vec<u32> = processes
        .iter()
        .filter(|p| needs_cwd_lookup(p))
        .map(|p| p.pid)
        .collect();
    attach_process_cwds(&mut processes, get_cwds_chunked(&cwd_pids));

    *state.0.lock().unwrap() = processes.iter().map(|p| p.pid).collect();
    Ok(processes)
}

#[tauri::command]
fn get_system_metrics() -> Result<SystemMetrics, String> {
    Ok(SystemMetrics {
        memory: get_memory_metrics()?,
        disk: get_disk_metrics()?,
        process_count: 0,
        listening_process_count: 0,
    })
}

/// Open a URL in the system default browser using macOS `open`.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| format!("Failed to open {url}: {e}"))?;
    Ok(())
}

/// Kill a process by PID with SIGKILL (allowlist-guarded).
#[tauri::command]
fn kill_pid(pid: u32, state: State<KnownPids>) -> Result<(), String> {
    if !state.0.lock().unwrap().contains(&pid) {
        return Err(format!(
            "PID {pid} is not in the current scan — refresh and try again"
        ));
    }

    let status = std::process::Command::new("/bin/kill")
        .args(["-9", &pid.to_string()])
        .status()
        .map_err(|e| format!("Failed to spawn kill: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "kill -9 {pid} failed — process may require elevated privileges"
        ))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(KnownPids(Mutex::new(HashSet::new())))
        .invoke_handler(tauri::generate_handler![
            list_listeners,
            list_listeners_admin,
            list_processes,
            get_system_metrics,
            kill_pid,
            open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_lsof_extracts_and_sorts_unique_listeners() {
        let output = r#"COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
node     2222 gabe   23u  IPv4 0xabc      0t0  TCP *:5173 (LISTEN)
Python   1111 gabe   10u  IPv4 0xdef      0t0  TCP 127.0.0.1:8000 (LISTEN)
node     2222 gabe   23u  IPv4 0xabc      0t0  TCP *:5173 (LISTEN)
badpid   nope gabe   23u  IPv4 0xabc      0t0  TCP *:9999 (LISTEN)
"#;

        let rows = parse_lsof(output);

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].pid, 2222);
        assert_eq!(rows[0].name, "node");
        assert_eq!(rows[0].port, "5173");
        assert_eq!(rows[0].address, "*:5173");
        assert_eq!(rows[1].pid, 1111);
        assert_eq!(rows[1].port, "8000");
    }

    #[test]
    fn parse_cwds_maps_pid_to_non_root_working_directory() {
        let output = "p10\nfcwd\nn/Users/gabe/project\np11\nfcwd\nn/\np12\nfcwd\nn/tmp/demo\n";

        let cwds = parse_cwds(output);

        assert_eq!(cwds.get(&10), Some(&"/Users/gabe/project".to_string()));
        assert_eq!(cwds.get(&12), Some(&"/tmp/demo".to_string()));
        assert!(!cwds.contains_key(&11));
    }

    #[test]
    fn format_etime_returns_compact_human_labels() {
        assert_eq!(format_etime("00:00:12"), "< 1m");
        assert_eq!(format_etime("03:04"), "3m");
        assert_eq!(format_etime("02:00:00"), "2h");
        assert_eq!(format_etime("02:34:00"), "2h 34m");
        assert_eq!(format_etime("3-00:00:01"), "3d");
        assert_eq!(format_etime("3-04:00:01"), "3d 4h");
    }

    #[test]
    fn parse_processes_preserves_command_and_derives_name() {
        let output = " 123 01:02:03 /usr/local/bin/node server.js\n 456 03:04 /Applications/Example App.app/Contents/MacOS/app --flag\n nope 03:04 bad\n";

        let rows = parse_processes(output);

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].pid, 456);
        assert_eq!(rows[0].name, "Example");
        assert_eq!(
            rows[0].command,
            "/Applications/Example App.app/Contents/MacOS/app --flag"
        );
        assert_eq!(rows[0].uptime.as_deref(), Some("3m"));
        assert_eq!(rows[1].pid, 123);
        assert_eq!(rows[1].name, "node");
        assert_eq!(rows[1].uptime.as_deref(), Some("1h 2m"));
    }
}
