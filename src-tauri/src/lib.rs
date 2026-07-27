mod git_sync;
mod vault;

use git_sync::SyncRuntime;
use vault::VaultState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(VaultState::default())
        .manage(SyncRuntime::default())
        .invoke_handler(tauri::generate_handler![
            vault::open_vault,
            vault::list_tree,
            vault::read_note,
            vault::write_note,
            vault::create_note,
            vault::create_folder,
            vault::rename_path,
            vault::move_entry,
            vault::delete_path,
            vault::resolve_wiki_target,
            vault::get_vault_path,
            vault::absolute_path,
            vault::write_asset,
            git_sync::sync_github_client_id,
            git_sync::sync_status,
            git_sync::sync_connect,
            git_sync::sync_disconnect,
            git_sync::sync_now,
            git_sync::sync_resolve_conflict,
            git_sync::sync_device_flow_start,
            git_sync::sync_device_flow_poll,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
