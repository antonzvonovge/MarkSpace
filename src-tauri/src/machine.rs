//! App-local machine identity and vault-shared machine registry.
//!
//! Identity lives in `{app_data}/machine.json` (stable id + display name).
//! Known machines for a vault are listed in `{vault}/.markspace/machines.json`
//! so routines can be pinned to a host that is currently offline.

use chrono::Local;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

use crate::vault::{get_root, VaultState};

const MAX_NAME_CHARS: usize = 80;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MachineIdentity {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VaultMachine {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub last_seen_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct MachinesDoc {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    machines: Vec<VaultMachine>,
}

fn default_hostname() -> String {
    if let Ok(name) = std::env::var("COMPUTERNAME") {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    if let Ok(name) = std::env::var("HOSTNAME") {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    if let Ok(raw) = fs::read_to_string("/etc/hostname") {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    "This computer".into()
}

fn normalize_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Machine name cannot be empty".into());
    }
    if trimmed.chars().count() > MAX_NAME_CHARS {
        return Err(format!("Machine name is too long (max {MAX_NAME_CHARS})"));
    }
    if trimmed.contains('\0') {
        return Err("Invalid machine name".into());
    }
    Ok(trimmed.to_string())
}

fn new_machine_id() -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"markspace-machine-v1");
    hasher.update(default_hostname().as_bytes());
    if let Ok(duration) = SystemTime::now().duration_since(UNIX_EPOCH) {
        hasher.update(duration.as_nanos().to_le_bytes());
    }
    #[cfg(unix)]
    if let Ok(bytes) = fs::read("/dev/urandom") {
        let n = bytes.len().min(16);
        hasher.update(&bytes[..n]);
    }
    let digest = hasher.finalize();
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        digest[0],
        digest[1],
        digest[2],
        digest[3],
        digest[4],
        digest[5],
        digest[6],
        digest[7],
        digest[8],
        digest[9],
        digest[10],
        digest[11],
        digest[12],
        digest[13],
        digest[14],
        digest[15]
    )
}

fn machine_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Cannot resolve app data dir: {err}"))?;
    Ok(dir.join("machine.json"))
}

pub fn load_or_create_identity(app: &AppHandle) -> Result<MachineIdentity, String> {
    let path = machine_file(app)?;
    if let Ok(raw) = fs::read_to_string(&path) {
        if let Ok(doc) = serde_json::from_str::<MachineIdentity>(&raw) {
            let id = doc.id.trim();
            let name = doc.name.trim();
            if !id.is_empty() && !name.is_empty() {
                return Ok(MachineIdentity {
                    id: id.to_string(),
                    name: name.to_string(),
                });
            }
        }
    }
    let identity = MachineIdentity {
        id: new_machine_id(),
        name: default_hostname(),
    };
    write_identity(app, &identity)?;
    Ok(identity)
}

fn write_identity(app: &AppHandle, identity: &MachineIdentity) -> Result<(), String> {
    let path = machine_file(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let body = serde_json::to_string_pretty(identity).map_err(|err| err.to_string())?;
    fs::write(path, format!("{body}\n")).map_err(|err| err.to_string())
}

fn machines_registry_path(root: &Path) -> PathBuf {
    root.join(".markspace").join("machines.json")
}

fn read_machines_doc(root: &Path) -> MachinesDoc {
    let path = machines_registry_path(root);
    let Ok(raw) = fs::read_to_string(path) else {
        return MachinesDoc::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn write_machines_doc(root: &Path, doc: &MachinesDoc) -> Result<(), String> {
    let path = machines_registry_path(root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let body = serde_json::to_string_pretty(doc).map_err(|err| err.to_string())?;
    fs::write(path, format!("{body}\n")).map_err(|err| err.to_string())
}

/// Upsert this computer into the vault registry (call on vault open).
pub fn register_current_machine(app: &AppHandle, root: &Path) -> Result<(), String> {
    let identity = load_or_create_identity(app)?;
    let mut doc = read_machines_doc(root);
    doc.version = 1;
    let seen = Local::now().to_rfc3339();
    if let Some(existing) = doc.machines.iter_mut().find(|m| m.id == identity.id) {
        existing.name = identity.name;
        existing.last_seen_at = seen;
    } else {
        doc.machines.push(VaultMachine {
            id: identity.id,
            name: identity.name,
            last_seen_at: seen,
        });
    }
    doc.machines.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.id.cmp(&b.id))
    });
    write_machines_doc(root, &doc)
}

pub fn list_machines(root: &Path) -> Vec<VaultMachine> {
    let mut machines = read_machines_doc(root).machines;
    machines.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.id.cmp(&b.id))
    });
    machines
}

pub fn machine_display_name(root: &Path, machine_id: &str) -> Option<String> {
    let id = machine_id.trim();
    if id.is_empty() {
        return None;
    }
    list_machines(root)
        .into_iter()
        .find(|m| m.id == id)
        .map(|m| m.name)
}

#[tauri::command]
pub fn get_machine_identity(app: AppHandle) -> Result<MachineIdentity, String> {
    load_or_create_identity(&app)
}

#[tauri::command]
pub fn set_machine_name(app: AppHandle, name: String) -> Result<MachineIdentity, String> {
    let name = normalize_name(&name)?;
    let mut identity = load_or_create_identity(&app)?;
    identity.name = name;
    write_identity(&app, &identity)?;
    let state = app.state::<VaultState>();
    if let Ok(root) = get_root(&state) {
        let _ = register_current_machine(&app, &root);
    }
    Ok(identity)
}

#[tauri::command]
pub fn list_vault_machines(state: State<VaultState>) -> Result<Vec<VaultMachine>, String> {
    let root = get_root(&state)?;
    Ok(list_machines(&root))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("markspace-machine-{nanos}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn registry_upserts_and_updates_name() {
        let root = temp_root();
        let mut doc = MachinesDoc {
            version: 1,
            machines: vec![VaultMachine {
                id: "m1".into(),
                name: "Old".into(),
                last_seen_at: "t0".into(),
            }],
        };
        write_machines_doc(&root, &doc).unwrap();

        doc.machines[0].name = "Laptop".into();
        doc.machines[0].last_seen_at = "t1".into();
        write_machines_doc(&root, &doc).unwrap();

        let loaded = list_machines(&root);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].name, "Laptop");
        assert_eq!(loaded[0].last_seen_at, "t1");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn normalize_name_rejects_empty() {
        assert!(normalize_name("  ").is_err());
        assert_eq!(normalize_name(" Desk ").unwrap(), "Desk");
    }
}
