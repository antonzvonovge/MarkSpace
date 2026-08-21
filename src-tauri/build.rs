fn main() {
    // tauri-build tracks tauri.conf.json, but not icon PNG/ICO/ICNS contents.
    println!("cargo:rerun-if-changed=icons");
    if let Ok(target) = std::env::var("TARGET") {
        println!("cargo:rustc-env=TARGET={target}");
        ensure_sidecar_stub(&target);
    }
    tauri_build::build()
}

/// Tauri `externalBin` requires the triple-suffixed file to exist at configure time.
/// Stage script overwrites this stub with the real binary before packaging/dev.
fn ensure_sidecar_stub(target: &str) {
    let manifest = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".into());
    let binaries = std::path::Path::new(&manifest).join("binaries");
    let _ = std::fs::create_dir_all(&binaries);
    let name = if cfg!(windows) {
        format!("markspace-embeddings-{target}.exe")
    } else {
        format!("markspace-embeddings-{target}")
    };
    let path = binaries.join(name);
    if path.exists() {
        return;
    }
    if std::fs::write(&path, []).is_ok() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755));
        }
    }
}
