mod vault;

use vault::VaultState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(VaultState::default())
        .invoke_handler(tauri::generate_handler![
            vault::open_vault,
            vault::list_tree,
            vault::read_note,
            vault::write_note,
            vault::create_note,
            vault::create_folder,
            vault::rename_path,
            vault::delete_path,
            vault::resolve_wiki_target,
            vault::get_vault_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
