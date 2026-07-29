fn main() {
    // tauri-build tracks tauri.conf.json, but not icon PNG/ICO/ICNS contents.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
