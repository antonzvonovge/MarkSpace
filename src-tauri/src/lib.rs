mod agent_memory;
mod chat_history;
mod comments;
mod diary;
mod dict_progress;
mod embeddings;
mod favorites;
mod filemeta;
mod gems;
mod git_sync;
mod http_fetch;
mod mcp;
mod order_merge;
mod pdf_text;
mod projects;
mod terminal;
mod vault;
mod vault_ai;

use git_sync::SyncRuntime;
use mcp::McpRuntime;
use terminal::TerminalRuntime;
use vault::VaultState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Keep classic (non-overlay) scrollbars on Linux. Overlay bars thicken on hover.
    #[cfg(target_os = "linux")]
    {
        // SAFETY: once at process start, before GTK / other threads initialize.
        unsafe {
            std::env::set_var("GTK_OVERLAY_SCROLLING", "0");

            // WebKitGTK's DMA-BUF renderer paints stale tiles on hybrid GPUs
            // (NVIDIA + integrated): panels keep old content until pointer
            // motion forces a full invalidate. Opt out unless the user set it.
            if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
                std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            }
        }
    }

    tauri::Builder::default()
        .setup(|app| {
            // Bundle icons are baked in at compile time; set explicitly so the
            // taskbar/dock picks up updates even when only icons/ changed.
            {
                use tauri::{image::Image, Manager};
                let icon = Image::from_bytes(include_bytes!("../icons/icon.png"))
                    .expect("app icon");
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_icon(icon);
                }
            }

            #[cfg(target_os = "linux")]
            {
                use gtk::prelude::*;
                use tauri::Manager;
                use webkit2gtk::{WebContextExt, WebViewExt};

                // Style native GTK scrollbars used by WebKitGTK: thin, no white trough.
                let css = r#"
                    scrollbar {
                        background: transparent;
                        border: none;
                        box-shadow: none;
                        min-width: 6px;
                        min-height: 6px;
                        padding: 0;
                        margin: 0;
                    }
                    scrollbar.vertical {
                        min-width: 6px;
                        padding: 0;
                    }
                    scrollbar.horizontal {
                        min-height: 6px;
                        padding: 0;
                    }
                    scrollbar contents,
                    scrollbar trough,
                    scrollbar overshoot,
                    scrollbar undershoot {
                        background: transparent;
                        border: none;
                        box-shadow: none;
                        min-width: 6px;
                        min-height: 6px;
                    }
                    scrollbar slider {
                        background-color: alpha(#5d6b73, 0.14);
                        border: none;
                        box-shadow: none;
                        border-radius: 6px;
                        min-width: 6px;
                        min-height: 24px;
                        margin: 0;
                        transition: background-color 120ms ease;
                    }
                    scrollbar slider:hover,
                    scrollbar slider:active {
                        background-color: alpha(#5d6b73, 0.5);
                        min-width: 6px;
                        min-height: 24px;
                    }
                    scrollbar button {
                        opacity: 0;
                        min-width: 0;
                        min-height: 0;
                        padding: 0;
                        margin: 0;
                        border: none;
                    }
                "#;

                if let Some(display) = gdk::Display::default() {
                    let provider = gtk::CssProvider::new();
                    if provider.load_from_data(css.as_bytes()).is_ok() {
                        gtk::StyleContext::add_provider_for_screen(
                            &display.default_screen(),
                            &provider,
                            gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
                        );
                    }
                }

                // wry defaults this to false (custom/CSS bars). Re-enable GTK painting
                // so our CssProvider above actually applies.
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.with_webview(|platform| {
                        let webview = platform.inner();
                        if let Some(context) = webview.context() {
                            context.set_use_system_appearance_for_scrollbars(true);
                            // Native Enchant/hunspell underlines ignore HTML spellcheck="false".
                            context.set_spell_checking_enabled(false);
                        }
                    });
                }
            }
            embeddings::start_embeddings_runtime();
            Ok(())
        })
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(VaultState::default())
        .manage(SyncRuntime::default())
        .manage(TerminalRuntime::default())
        .manage(McpRuntime::default())
        .invoke_handler(tauri::generate_handler![
            vault::open_vault,
            vault::list_tree,
            vault::read_note,
            vault::write_note,
            vault::create_note,
            vault::create_drawio,
            vault::create_mdlnks,
            vault::create_mddict,
            vault::create_mdhabit,
            vault::import_drawio,
            vault::import_paths,
            vault::import_document_bytes,
            vault::create_folder,
            vault::ensure_folder,
            vault::ensure_folder_note,
            vault::rename_path,
            vault::move_entry,
            vault::promote_note_to_folder,
            vault::nest_under_note,
            vault::delete_path,
            vault::delete_folder_if_empty,
            vault::resolve_wiki_target,
            vault::get_vault_path,
            vault::absolute_path,
            vault::write_asset,
            vault::read_file_bytes,
            vault::write_file_bytes,
            vault::search_notes,
            vault::list_vault_tags,
            vault::list_diary_day_markers,
            vault::list_dictionary_tags,
            vault::list_note_tags,
            vault::reindex_note_tags,
            pdf_text::extract_pdf_text_cmd,
            embeddings::worker::semantic_search_notes,
            embeddings::worker::get_embeddings_index_status,
            embeddings::download::get_embedding_model_status,
            embeddings::download::download_embedding_model,
            favorites::list_favorites,
            favorites::add_favorite,
            favorites::remove_favorite,
            filemeta::get_file_tags,
            filemeta::set_file_tags,
            comments::list_note_comments,
            comments::list_all_comments,
            comments::upsert_note_comment,
            comments::delete_note_comment,
            comments::set_comment_resolved,
            projects::get_project_properties,
            projects::set_project_properties,
            projects::list_project_properties,
            gems::list_gems,
            gems::get_gem,
            gems::upsert_gem,
            gems::delete_gem,
            dict_progress::get_dict_progress,
            dict_progress::set_dict_entry_progress,
            agent_memory::get_agent_memory,
            agent_memory::set_agent_memory_enabled,
            agent_memory::add_agent_memory,
            agent_memory::update_agent_memory,
            agent_memory::delete_agent_memory,
            agent_memory::clear_agent_memory,
            diary::get_diary_settings,
            diary::set_diary_settings,
            vault_ai::get_vault_ai_settings,
            vault_ai::set_vault_ai_settings,
            mcp::mcp_list_snapshot,
            mcp::mcp_sync,
            mcp::mcp_get_vault,
            mcp::mcp_set_vault,
            mcp::mcp_reload,
            mcp::mcp_reload_server,
            mcp::mcp_call_tool,
            http_fetch::http_fetch,
            http_fetch::http_fetch_bytes,
            terminal::run_terminal_command,
            terminal::kill_terminal_command,
            chat_history::list_chat_threads,
            chat_history::get_chat_thread,
            chat_history::get_chat_thread_path,
            chat_history::upsert_chat_thread,
            chat_history::delete_chat_thread,
            chat_history::set_active_chat_thread,
            chat_history::set_open_chat_tabs,
            git_sync::sync_github_client_id,
            git_sync::sync_status,
            git_sync::sync_connect,
            git_sync::sync_disconnect,
            git_sync::sync_now,
            git_sync::sync_resolve_conflict,
            git_sync::sync_device_flow_start,
            git_sync::sync_device_flow_poll,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                embeddings::flush_index();
            }
        });
}
