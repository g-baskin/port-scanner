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
    /// Basename of the process's working directory (the "project folder").
    pub project: Option<String>,
    /// Full path to the working directory, used as a tooltip in the UI.
    pub cwd: Option<String>,
    /// Human-readable time the process has been running, e.g. "2h 34m".
    pub uptime: Option<String>,
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
fn attach_cwds(processes: &mut Vec<PortProcess>, cwds: HashMap<u32, String>) {
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

    let segments: Vec<u64> = rest
        .split(':')
        .filter_map(|s| s.parse().ok())
        .collect();

    let (hours, minutes, _seconds) = match segments.as_slice() {
        [h, m, s] => (*h, *m, *s),
        [m, s]    => (0, *m, *s),
        [s]       => (0, 0, *s),
        _         => (0, 0, 0),
    };

    if days > 0 {
        if hours > 0 { format!("{}d {}h", days, hours) } else { format!("{}d", days) }
    } else if hours > 0 {
        if minutes > 0 { format!("{}h {}m", hours, minutes) } else { format!("{}h", hours) }
    } else if minutes > 0 {
        format!("{}m", minutes)
    } else {
        "< 1m".to_string()
    }
}

/// Attach uptime strings into process records.
fn attach_uptimes(processes: &mut Vec<PortProcess>, uptimes: HashMap<u32, String>) {
    for p in processes.iter_mut() {
        if let Some(t) = uptimes.get(&p.pid) {
            p.uptime = Some(t.clone());
        }
    }
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
    attach_cwds(&mut processes, get_cwds(&pids));
    attach_uptimes(&mut processes, get_uptimes(&pids));

    *state.0.lock().unwrap() = processes.iter().map(|p| p.pid).collect();
    Ok(processes)
}

/// Uses osascript to run lsof with a one-time administrator privileges prompt.
#[tauri::command]
fn list_listeners_admin(state: State<KnownPids>) -> Result<Vec<PortProcess>, String> {
    let script =
        r#"do shell script "lsof -n -P -iTCP -sTCP:LISTEN" with administrator privileges"#;

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
    attach_cwds(&mut processes, get_cwds(&pids));
    attach_uptimes(&mut processes, get_uptimes(&pids));

    *state.0.lock().unwrap() = processes.iter().map(|p| p.pid).collect();
    Ok(processes)
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
            kill_pid,
            open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
