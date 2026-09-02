use git2::{
    AnnotatedCommit, Cred, ErrorCode, FetchOptions, FileFavor, IndexAddOption, IndexEntry,
    IndexTime, MergeFileOptions, PushOptions, RemoteCallbacks, Repository, Signature,
    StatusOptions, build::CheckoutBuilder,
};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

use crate::md_merge;
use crate::order_merge::{self, ORDER_REL};
use crate::vault::VaultState;

const DEFAULT_GITIGNORE: &str = "\
.DS_Store
Thumbs.db
*.swp
*.swo
*~
";

/// Optional OAuth App client id (compile with MARKSPACE_GITHUB_CLIENT_ID=...).
fn github_client_id() -> Option<&'static str> {
    match option_env!("MARKSPACE_GITHUB_CLIENT_ID") {
        Some(id) if !id.is_empty() => Some(id),
        _ => None,
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub connected: bool,
    pub is_repo: bool,
    pub remote_url: Option<String>,
    pub branch: Option<String>,
    pub dirty: bool,
    pub ahead: u32,
    pub behind: u32,
    pub conflicted: Vec<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub status: SyncStatus,
    pub message: String,
    pub conflicted: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeviceTokenResponse {
    pub access_token: Option<String>,
    pub error: Option<String>,
    pub error_description: Option<String>,
}

#[derive(Default)]
pub struct SyncRuntime {
    /// In-flight device code for polling.
    pub device_code: Mutex<Option<String>>,
}

/// Sync commands run on a thread pool, so two of them could otherwise interleave
/// writes to the same git index. Every repository mutation takes this first.
static REPO_LOCK: Mutex<()> = Mutex::new(());

fn repo_guard() -> std::sync::MutexGuard<'static, ()> {
    REPO_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn vault_root(state: &VaultState) -> Result<PathBuf, String> {
    state
        .root
        .lock()
        .map_err(|_| "Vault state lock poisoned".to_string())?
        .clone()
        .ok_or_else(|| "No vault open".to_string())
}

fn empty_status(err: Option<String>) -> SyncStatus {
    SyncStatus {
        connected: false,
        is_repo: false,
        remote_url: None,
        branch: None,
        dirty: false,
        ahead: 0,
        behind: 0,
        conflicted: Vec::new(),
        last_error: err,
    }
}

fn normalize_remote_url(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Repository URL is empty".into());
    }
    if trimmed.starts_with("https://") || trimmed.starts_with("http://") || trimmed.starts_with("git@")
    {
        return Ok(trimmed.to_string());
    }
    // owner/repo shorthand → HTTPS GitHub
    if trimmed.matches('/').count() == 1 && !trimmed.contains(' ') {
        let (owner, repo) = trimmed.split_once('/').unwrap();
        if !owner.is_empty() && !repo.is_empty() {
            let repo = repo.trim_end_matches(".git");
            return Ok(format!("https://github.com/{owner}/{repo}.git"));
        }
    }
    Err("Enter a GitHub URL or owner/repo".into())
}

fn make_signature() -> Result<Signature<'static>, String> {
    Signature::now("MarkSpace", "markspace@local")
        .map_err(|e| format!("Cannot create git signature: {e}"))
}

fn with_remote_callbacks(token: Option<&str>) -> RemoteCallbacks<'_> {
    let mut callbacks = RemoteCallbacks::new();
    if let Some(token) = token {
        let token = token.to_string();
        callbacks.credentials(move |url, username_from_url, allowed| {
            if allowed.contains(git2::CredentialType::USER_PASS_PLAINTEXT) {
                return Cred::userpass_plaintext(
                    username_from_url.unwrap_or("x-access-token"),
                    &token,
                );
            }
            if allowed.contains(git2::CredentialType::DEFAULT) {
                return Cred::default();
            }
            Err(git2::Error::from_str(&format!(
                "No supported credentials for {url}"
            )))
        });
    }
    callbacks
}

fn open_repo(root: &Path) -> Result<Repository, String> {
    Repository::open(root).map_err(|e| format!("Not a git repository: {e}"))
}

fn ensure_gitignore(root: &Path) -> Result<(), String> {
    let path = root.join(".gitignore");
    if path.exists() {
        return Ok(());
    }
    std::fs::write(&path, DEFAULT_GITIGNORE).map_err(|e| format!("Cannot write .gitignore: {e}"))
}

fn remote_url(repo: &Repository) -> Option<String> {
    repo.find_remote("origin")
        .ok()
        .and_then(|r| r.url().map(|s| s.to_string()))
}

fn current_branch(repo: &Repository) -> Option<String> {
    repo.head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
}

fn conflicted_paths(repo: &Repository) -> Vec<String> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(false).recurse_untracked_dirs(false);
    let Ok(statuses) = repo.statuses(Some(&mut opts)) else {
        return Vec::new();
    };
    statuses
        .iter()
        .filter(|e| e.status().intersects(git2::Status::CONFLICTED))
        .filter_map(|e| e.path().map(|p| p.replace('\\', "/")))
        .collect()
}

fn is_dirty(repo: &Repository) -> bool {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .exclude_submodules(true);
    match repo.statuses(Some(&mut opts)) {
        Ok(statuses) => statuses.iter().any(|e| {
            let s = e.status();
            !s.is_empty() && !s.contains(git2::Status::IGNORED)
        }),
        Err(_) => false,
    }
}

fn ahead_behind(repo: &Repository) -> (u32, u32) {
    let Ok(head) = repo.head() else {
        return (0, 0);
    };
    let Some(local_oid) = head.target() else {
        return (0, 0);
    };
    let branch_name = head.shorthand().unwrap_or("main");
    let upstream_name = format!("refs/remotes/origin/{branch_name}");
    let Ok(upstream) = repo.refname_to_id(&upstream_name) else {
        return (0, 0);
    };
    match repo.graph_ahead_behind(local_oid, upstream) {
        Ok((ahead, behind)) => (ahead as u32, behind as u32),
        Err(_) => (0, 0),
    }
}

fn build_status(repo: &Repository) -> SyncStatus {
    let remote = remote_url(repo);
    let conflicted = conflicted_paths(repo);
    let (ahead, behind) = ahead_behind(repo);
    SyncStatus {
        connected: remote.is_some(),
        is_repo: true,
        remote_url: remote,
        branch: current_branch(repo),
        dirty: is_dirty(repo),
        ahead,
        behind,
        conflicted: conflicted.clone(),
        last_error: None,
    }
}

fn stage_all(repo: &Repository) -> Result<(), String> {
    let mut index = repo
        .index()
        .map_err(|e| format!("Cannot read index: {e}"))?;
    index
        .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
        .map_err(|e| format!("Cannot stage files: {e}"))?;
    index
        .write()
        .map_err(|e| format!("Cannot write index: {e}"))?;
    Ok(())
}

fn commit_all_if_dirty(repo: &Repository, message: &str) -> Result<bool, String> {
    if !is_dirty(repo) && conflicted_paths(repo).is_empty() {
        // Still may need an empty check against HEAD tree
        let mut opts = StatusOptions::new();
        opts.include_untracked(true).recurse_untracked_dirs(true);
        let statuses = repo
            .statuses(Some(&mut opts))
            .map_err(|e| format!("status: {e}"))?;
        if statuses.is_empty() {
            return Ok(false);
        }
    }

    stage_all(repo)?;

    let mut index = repo
        .index()
        .map_err(|e| format!("Cannot read index: {e}"))?;
    let tree_oid = index
        .write_tree()
        .map_err(|e| format!("Cannot write tree: {e}"))?;
    let tree = repo
        .find_tree(tree_oid)
        .map_err(|e| format!("Cannot find tree: {e}"))?;
    let sig = make_signature()?;

    let parent_commit = match repo.head() {
        Ok(head) => {
            let oid = head
                .target()
                .ok_or_else(|| "HEAD has no target".to_string())?;
            Some(
                repo.find_commit(oid)
                    .map_err(|e| format!("Cannot find HEAD commit: {e}"))?,
            )
        }
        Err(e) if e.code() == ErrorCode::UnbornBranch || e.code() == ErrorCode::NotFound => None,
        Err(e) => return Err(format!("Cannot read HEAD: {e}")),
    };

    let parents: Vec<&git2::Commit> = parent_commit.iter().collect();

    // Skip if tree unchanged
    if let Some(parent) = &parent_commit {
        if parent.tree_id() == tree_oid {
            return Ok(false);
        }
    }

    repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
        .map_err(|e| format!("Commit failed: {e}"))?;
    Ok(true)
}

fn do_fetch(repo: &Repository, token: Option<&str>) -> Result<(), String> {
    let mut remote = repo
        .find_remote("origin")
        .map_err(|e| format!("No origin remote: {e}"))?;
    let callbacks = with_remote_callbacks(token);
    let mut opts = FetchOptions::new();
    opts.remote_callbacks(callbacks);
    remote
        .fetch(&[] as &[&str], Some(&mut opts), None)
        .map_err(|e| format!("Fetch failed: {e}"))?;
    Ok(())
}

fn annotated_commit_for_fetch_head(repo: &Repository) -> Result<AnnotatedCommit<'_>, String> {
    let fetch_head = repo
        .find_reference("FETCH_HEAD")
        .map_err(|e| format!("No FETCH_HEAD after fetch: {e}"))?;
    repo.reference_to_annotated_commit(&fetch_head)
        .map_err(|e| format!("Cannot read FETCH_HEAD: {e}"))
}

fn do_merge(repo: &Repository, fetch_commit: &AnnotatedCommit<'_>) -> Result<Vec<String>, String> {
    let analysis = repo
        .merge_analysis(&[fetch_commit])
        .map_err(|e| format!("Merge analysis failed: {e}"))?;

    if analysis.0.is_up_to_date() {
        return Ok(Vec::new());
    }

    if analysis.0.is_fast_forward() {
        let branch_name = current_branch(repo).unwrap_or_else(|| "main".into());
        let refname = format!("refs/heads/{branch_name}");
        match repo.find_reference(&refname) {
            Ok(mut reference) => {
                reference
                    .set_target(fetch_commit.id(), "MarkSpace fast-forward")
                    .map_err(|e| format!("Fast-forward failed: {e}"))?;
                repo.set_head(&refname)
                    .map_err(|e| format!("Cannot set HEAD: {e}"))?;
                repo.checkout_head(Some(CheckoutBuilder::default().force()))
                    .map_err(|e| format!("Checkout failed: {e}"))?;
            }
            Err(_) => {
                // Unborn or missing local branch — set HEAD to fetched commit
                repo.set_head_detached(fetch_commit.id())
                    .map_err(|e| format!("Cannot detach HEAD: {e}"))?;
                let _ = repo.branch(&branch_name, &repo.find_commit(fetch_commit.id()).map_err(|e| format!("{e}"))?, false);
                let refname = format!("refs/heads/{branch_name}");
                repo.set_head(&refname)
                    .map_err(|e| format!("Cannot set HEAD: {e}"))?;
                repo.checkout_head(Some(CheckoutBuilder::default().force()))
                    .map_err(|e| format!("Checkout failed: {e}"))?;
            }
        }
        return Ok(Vec::new());
    }

    // Normal merge — `.md` conflicts are Accept-Both'd automatically below.
    repo.merge(&[fetch_commit], None, None)
        .map_err(|e| format!("Merge failed: {e}"))?;

    let _ = auto_resolve_order_conflict(repo)?;
    let _ = auto_resolve_delete_conflicts(repo)?;
    let _ = auto_resolve_md_both_conflicts(repo)?;
    let conflicts = conflicted_paths(repo);
    if !conflicts.is_empty() {
        return Ok(conflicts);
    }

    finalize_merge_commit(repo)?;
    Ok(Vec::new())
}

fn blob_text_at_stage(
    repo: &Repository,
    rel: &str,
    stage: i32,
) -> Result<String, String> {
    let index = repo
        .index()
        .map_err(|e| format!("Cannot read index: {e}"))?;
    let Some(entry) = index.get_path(Path::new(rel), stage) else {
        return Ok(String::new());
    };
    let blob = repo
        .find_blob(entry.id)
        .map_err(|e| format!("Cannot read blob for {rel} stage {stage}: {e}"))?;
    String::from_utf8(blob.content().to_vec())
        .map_err(|e| format!("order.json is not UTF-8: {e}"))
}

fn is_order_rel(rel: &str) -> bool {
    rel == ORDER_REL || rel.replace('\\', "/") == ORDER_REL
}

fn looks_binary(bytes: &[u8]) -> bool {
    bytes.contains(&0)
}

/// If `.markspace/order.json` is conflicted, merge it semantically and stage the result.
/// Returns true when a conflict was resolved.
fn auto_resolve_order_conflict(repo: &Repository) -> Result<bool, String> {
    let conflicts = conflicted_paths(repo);
    if !conflicts.iter().any(|p| is_order_rel(p)) {
        return Ok(false);
    }

    let base_raw = blob_text_at_stage(repo, ORDER_REL, 1)?;
    let ours_raw = blob_text_at_stage(repo, ORDER_REL, 2)?;
    let theirs_raw = blob_text_at_stage(repo, ORDER_REL, 3)?;

    let base = order_merge::parse_order(&base_raw);
    let ours = order_merge::parse_order(&ours_raw);
    let theirs = order_merge::parse_order(&theirs_raw);
    let merged = order_merge::merge_order_maps(&base, &ours, &theirs);
    let content = order_merge::serialize_order(&merged);

    write_and_stage(repo, ORDER_REL, content.as_bytes())?;
    Ok(true)
}

/// Resolve delete/modify conflicts:
/// - both deleted → accept deletion
/// - one side deleted, other modified → keep the modified version
fn auto_resolve_delete_conflicts(repo: &Repository) -> Result<usize, String> {
    let conflicts = conflicted_paths(repo);
    let mut n = 0;
    for rel in &conflicts {
        if resolve_delete_conflict(repo, rel)? {
            n += 1;
        }
    }
    Ok(n)
}

fn resolve_delete_conflict(repo: &Repository, rel: &str) -> Result<bool, String> {
    let index = repo
        .index()
        .map_err(|e| format!("Cannot read index: {e}"))?;
    let stage2 = index.get_path(Path::new(rel), 2);
    let stage3 = index.get_path(Path::new(rel), 3);

    match (stage2, stage3) {
        (None, None) => {
            // Deleted on both sides — accept deletion.
            drop(index);
            let mut index = repo
                .index()
                .map_err(|e| format!("Cannot read index: {e}"))?;
            index
                .remove_path(Path::new(rel))
                .map_err(|e| format!("Cannot remove {rel} from index: {e}"))?;
            index
                .write()
                .map_err(|e| format!("Cannot write index: {e}"))?;
            if let Some(workdir) = repo.workdir() {
                let abs = workdir.join(rel);
                if abs.exists() {
                    let _ = std::fs::remove_file(&abs);
                }
            }
            Ok(true)
        }
        (None, Some(entry)) => keep_conflict_stage(repo, rel, entry),
        (Some(entry), None) => keep_conflict_stage(repo, rel, entry),
        (Some(_), Some(_)) => Ok(false),
    }
}

fn keep_conflict_stage(repo: &Repository, rel: &str, entry: IndexEntry) -> Result<bool, String> {
    let blob = repo
        .find_blob(entry.id)
        .map_err(|e| format!("Cannot read blob for {rel}: {e}"))?;
    write_and_stage(repo, rel, blob.content())?;
    Ok(true)
}

/// Skips `order.json` (semantic merge), binaries, `.drawio`, and other non-markdown.
fn auto_resolve_md_both_conflicts(repo: &Repository) -> Result<usize, String> {
    let conflicts = conflicted_paths(repo);
    let mut n = 0;
    for rel in conflicts {
        if !is_markdown_rel(&rel) || is_order_rel(&rel) {
            continue;
        }
        if resolve_md_both(repo, &rel)? {
            n += 1;
        }
    }
    Ok(n)
}

fn is_markdown_rel(rel: &str) -> bool {
    rel.to_ascii_lowercase().ends_with(".md")
}

fn is_drawio_rel(rel: &str) -> bool {
    rel.to_ascii_lowercase().ends_with(".drawio")
}

fn write_and_stage(repo: &Repository, rel: &str, content: &[u8]) -> Result<(), String> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| "Repository has no working directory".to_string())?;
    let abs = workdir.join(rel);
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    std::fs::write(&abs, content).map_err(|e| format!("write {rel}: {e}"))?;

    let mut index = repo
        .index()
        .map_err(|e| format!("Cannot read index: {e}"))?;
    index
        .add_path(Path::new(rel))
        .map_err(|e| format!("Cannot stage {rel}: {e}"))?;
    index
        .write()
        .map_err(|e| format!("Cannot write index: {e}"))?;
    Ok(())
}

fn empty_ancestor_entry(repo: &Repository, template: &IndexEntry) -> Result<IndexEntry, String> {
    let oid = repo
        .blob(&[])
        .map_err(|e| format!("Cannot create empty blob: {e}"))?;
    Ok(IndexEntry {
        ctime: IndexTime::new(0, 0),
        mtime: IndexTime::new(0, 0),
        dev: 0,
        ino: 0,
        mode: template.mode,
        uid: 0,
        gid: 0,
        file_size: 0,
        id: oid,
        flags: template.flags & 0x0FFF, // clear stage bits; path length kept
        flags_extended: 0,
        path: template.path.clone(),
    })
}

/// Strip git conflict markers, keeping both sides of each hunk (VS Code "Accept Both").
fn accept_both_from_markers(text: &str) -> Option<String> {
    if !text.contains("<<<<<<<") {
        return None;
    }
    let mut out = String::with_capacity(text.len());
    let mut in_conflict = false;
    let mut saw_marker = false;
    for line in text.lines() {
        if line.starts_with("<<<<<<<") {
            in_conflict = true;
            saw_marker = true;
            continue;
        }
        if in_conflict && line.starts_with("=======") {
            continue;
        }
        if in_conflict && line.starts_with(">>>>>>>") {
            in_conflict = false;
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    // Preserve final newline presence roughly; ensure we only claim success with markers.
    if !saw_marker {
        return None;
    }
    Some(out)
}

/// Resolve a conflicted `.md` by keeping both sides (semantic frontmatter merge when possible).
fn resolve_md_both(repo: &Repository, rel: &str) -> Result<bool, String> {
    let index = repo
        .index()
        .map_err(|e| format!("Cannot read index: {e}"))?;
    let Some(ours) = index.get_path(Path::new(rel), 2) else {
        return Ok(false);
    };
    let Some(theirs) = index.get_path(Path::new(rel), 3) else {
        return Ok(false);
    };

    let ours_blob = repo
        .find_blob(ours.id)
        .map_err(|e| format!("Cannot read ours blob for {rel}: {e}"))?;
    let theirs_blob = repo
        .find_blob(theirs.id)
        .map_err(|e| format!("Cannot read theirs blob for {rel}: {e}"))?;
    if looks_binary(ours_blob.content()) || looks_binary(theirs_blob.content()) {
        return Ok(false);
    }

    let ours_text = String::from_utf8_lossy(ours_blob.content()).into_owned();
    let theirs_text = String::from_utf8_lossy(theirs_blob.content()).into_owned();
    let base_text = index
        .get_path(Path::new(rel), 1)
        .and_then(|entry| repo.find_blob(entry.id).ok())
        .map(|blob| String::from_utf8_lossy(blob.content()).into_owned());

    if let Some(merged) = md_merge::merge_markdown_notes(
        &ours_text,
        &theirs_text,
        base_text.as_deref(),
    ) {
        write_and_stage(repo, rel, merged.as_bytes())?;
        return Ok(true);
    }

    // Prefer workdir conflict markers → Accept Both (ours hunk then theirs hunk).
    let workdir = repo
        .workdir()
        .ok_or_else(|| "Repository has no working directory".to_string())?;
    let abs = workdir.join(rel);
    if let Ok(raw) = std::fs::read_to_string(&abs) {
        if let Some(merged) = accept_both_from_markers(&raw) {
            write_and_stage(repo, rel, merged.as_bytes())?;
            return Ok(true);
        }
    }

    // Fallback: libgit2 union (unique lines from both sides).
    resolve_path_union(repo, rel)
}

/// Union-merge a single conflicted path (keep both sides' unique lines).
/// Returns false when the conflict cannot be union-resolved (modify/delete, binary).
fn resolve_path_union(repo: &Repository, rel: &str) -> Result<bool, String> {
    let index = repo
        .index()
        .map_err(|e| format!("Cannot read index: {e}"))?;
    let Some(ours) = index.get_path(Path::new(rel), 2) else {
        return Ok(false);
    };
    let Some(theirs) = index.get_path(Path::new(rel), 3) else {
        return Ok(false);
    };

    let ours_blob = repo
        .find_blob(ours.id)
        .map_err(|e| format!("Cannot read ours blob for {rel}: {e}"))?;
    let theirs_blob = repo
        .find_blob(theirs.id)
        .map_err(|e| format!("Cannot read theirs blob for {rel}: {e}"))?;
    if looks_binary(ours_blob.content()) || looks_binary(theirs_blob.content()) {
        return Ok(false);
    }

    let ancestor = match index.get_path(Path::new(rel), 1) {
        Some(entry) => entry,
        None => empty_ancestor_entry(repo, &ours)?,
    };

    let mut opts = MergeFileOptions::new();
    opts.favor(FileFavor::Union);
    let result = repo
        .merge_file_from_index(&ancestor, &ours, &theirs, Some(&mut opts))
        .map_err(|e| format!("Union merge failed for {rel}: {e}"))?;

    write_and_stage(repo, rel, result.content())?;
    Ok(true)
}

fn finalize_merge_commit(repo: &Repository) -> Result<(), String> {
    if !matches!(
        repo.state(),
        git2::RepositoryState::Merge
            | git2::RepositoryState::Revert
            | git2::RepositoryState::CherryPick
    ) {
        return Ok(());
    }

    let mut index = repo
        .index()
        .map_err(|e| format!("Cannot read index: {e}"))?;
    let tree_oid = index
        .write_tree()
        .map_err(|e| format!("Cannot write merge tree: {e}"))?;
    let tree = repo
        .find_tree(tree_oid)
        .map_err(|e| format!("Cannot find merge tree: {e}"))?;
    let sig = make_signature()?;
    let head_commit = repo
        .head()
        .map_err(|e| format!("HEAD: {e}"))?
        .peel_to_commit()
        .map_err(|e| format!("HEAD commit: {e}"))?;

    let merge_head = repo
        .find_reference("MERGE_HEAD")
        .ok()
        .and_then(|r| r.target())
        .and_then(|oid| repo.find_commit(oid).ok());

    let parents: Vec<&git2::Commit> = match &merge_head {
        Some(m) => vec![&head_commit, m],
        None => vec![&head_commit],
    };

    repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        "MarkSpace merge",
        &tree,
        &parents,
    )
    .map_err(|e| format!("Merge commit failed: {e}"))?;

    repo.cleanup_state()
        .map_err(|e| format!("cleanup_state: {e}"))?;
    Ok(())
}

fn do_push(repo: &Repository, token: Option<&str>) -> Result<(), String> {
    let mut remote = repo
        .find_remote("origin")
        .map_err(|e| format!("No origin remote: {e}"))?;
    let branch = current_branch(repo).unwrap_or_else(|| "main".into());
    let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");
    let callbacks = with_remote_callbacks(token);
    let mut opts = PushOptions::new();
    opts.remote_callbacks(callbacks);
    remote
        .push(&[refspec.as_str()], Some(&mut opts))
        .map_err(|e| format!("Push failed: {e}"))?;
    Ok(())
}

#[tauri::command(async)]
pub fn sync_github_client_id() -> Option<String> {
    github_client_id().map(|s| s.to_string())
}

#[tauri::command(async)]
pub fn sync_status(vault: State<'_, VaultState>) -> Result<SyncStatus, String> {
    let _guard = repo_guard();
    let root = match vault_root(&vault) {
        Ok(r) => r,
        Err(e) => return Ok(empty_status(Some(e))),
    };
    match Repository::open(&root) {
        Ok(repo) => Ok(build_status(&repo)),
        Err(_) => Ok(empty_status(None)),
    }
}

#[tauri::command(async)]
pub fn sync_connect(
    remote_url: String,
    token: Option<String>,
    vault: State<'_, VaultState>,
) -> Result<SyncStatus, String> {
    let _guard = repo_guard();
    let root = vault_root(&vault)?;
    let url = normalize_remote_url(&remote_url)?;
    let token_ref = token.as_deref().filter(|t| !t.is_empty());

    ensure_gitignore(&root)?;

    let repo = match Repository::open(&root) {
        Ok(repo) => repo,
        Err(_) => Repository::init(&root).map_err(|e| format!("git init failed: {e}"))?,
    };

    // Set or update origin
    match repo.find_remote("origin") {
        Ok(_) => {
            repo.remote_set_url("origin", &url)
                .map_err(|e| format!("Cannot set origin URL: {e}"))?;
        }
        Err(_) => {
            repo.remote("origin", &url)
                .map_err(|e| format!("Cannot add origin: {e}"))?;
        }
    }

    // Ensure we have an initial commit if the repo is empty
    if repo.head().is_err() {
        let _ = commit_all_if_dirty(&repo, "MarkSpace initial commit")?;
        // If still no HEAD (empty vault), create empty commit
        if repo.head().is_err() {
            let mut index = repo.index().map_err(|e| format!("{e}"))?;
            let tree_oid = index.write_tree().map_err(|e| format!("{e}"))?;
            let tree = repo.find_tree(tree_oid).map_err(|e| format!("{e}"))?;
            let sig = make_signature()?;
            repo.commit(Some("HEAD"), &sig, &sig, "MarkSpace initial commit", &tree, &[])
                .map_err(|e| format!("Initial commit failed: {e}"))?;
        }
    }

    // Try fetch to verify credentials / remote
    if let Err(e) = do_fetch(&repo, token_ref) {
        // Remote may be empty (new repo) — still OK if we can push later
        let msg = e.to_lowercase();
        if !msg.contains("not found") && !msg.contains("empty") && !msg.contains("couldn't find") {
            // Keep connection but surface soft warning via status
            let mut status = build_status(&repo);
            status.last_error = Some(e);
            // Still connected if remote is set
            return Ok(status);
        }
    } else if let Ok(fetch_commit) = annotated_commit_for_fetch_head(&repo) {
        let conflicts = do_merge(&repo, &fetch_commit)?;
        if !conflicts.is_empty() {
            let mut status = build_status(&repo);
            status.conflicted = conflicts;
            status.last_error = Some("Connected with merge conflicts — resolve them, then Sync".into());
            return Ok(status);
        }
    }

    Ok(build_status(&repo))
}

#[tauri::command(async)]
pub fn sync_disconnect(vault: State<'_, VaultState>) -> Result<SyncStatus, String> {
    let _guard = repo_guard();
    let root = vault_root(&vault)?;
    let repo = match Repository::open(&root) {
        Ok(r) => r,
        Err(_) => return Ok(empty_status(None)),
    };
    // Remove origin remote only — keep local history
    if repo.find_remote("origin").is_ok() {
        repo.remote_delete("origin")
            .map_err(|e| format!("Cannot remove origin: {e}"))?;
    }
    Ok(build_status(&repo))
}

#[tauri::command(async)]
pub fn sync_now(
    token: Option<String>,
    vault: State<'_, VaultState>,
) -> Result<SyncResult, String> {
    let _guard = repo_guard();
    let root = vault_root(&vault)?;
    let repo = open_repo(&root)?;
    if remote_url(&repo).is_none() {
        return Err("Not connected — set a repository in Settings → Sync".into());
    }
    let token_ref = token.as_deref().filter(|t| !t.is_empty());

    let existing_conflicts = conflicted_paths(&repo);
    if !existing_conflicts.is_empty() {
        let _ = auto_resolve_order_conflict(&repo)?;
        let _ = auto_resolve_delete_conflicts(&repo)?;
        let _ = auto_resolve_md_both_conflicts(&repo)?;
        let remaining = conflicted_paths(&repo);
        if remaining.is_empty() {
            finalize_merge_commit(&repo)?;
        } else {
            return Ok(SyncResult {
                status: build_status(&repo),
                message: "Resolve conflicts before syncing".into(),
                conflicted: remaining,
            });
        }
    }

    let _ = commit_all_if_dirty(&repo, "MarkSpace sync")?;

    do_fetch(&repo, token_ref)?;

    let conflicts = match annotated_commit_for_fetch_head(&repo) {
        Ok(fetch_commit) => do_merge(&repo, &fetch_commit)?,
        Err(_) => {
            // Empty remote — just push
            Vec::new()
        }
    };

    if !conflicts.is_empty() {
        return Ok(SyncResult {
            status: build_status(&repo),
            message: "Merge conflicts — resolve them, then Sync again".into(),
            conflicted: conflicts,
        });
    }

    do_push(&repo, token_ref)?;

    // Refresh ahead/behind after push
    let _ = do_fetch(&repo, token_ref);

    Ok(SyncResult {
        status: build_status(&repo),
        message: "Synced".into(),
        conflicted: Vec::new(),
    })
}

#[tauri::command(async)]
pub fn sync_resolve_conflict(
    path: String,
    choice: String,
    vault: State<'_, VaultState>,
) -> Result<SyncStatus, String> {
    let _guard = repo_guard();
    let root = vault_root(&vault)?;
    let repo = open_repo(&root)?;
    let rel = path.trim().trim_start_matches('/');

    match choice.as_str() {
        "ours" | "theirs" => {
            let index = repo
                .index()
                .map_err(|e| format!("Cannot read index: {e}"))?;
            let stage = if choice == "ours" { 2 } else { 3 };
            let entry = index
                .get_path(Path::new(rel), stage)
                .ok_or_else(|| format!("No conflict stage {stage} for {rel}"))?;
            let blob = repo
                .find_blob(entry.id)
                .map_err(|e| format!("Cannot read blob: {e}"))?;
            write_and_stage(&repo, rel, blob.content())?;
        }
        "both" => {
            if is_order_rel(rel) {
                let _ = auto_resolve_order_conflict(&repo)?;
                if conflicted_paths(&repo)
                    .iter()
                    .any(|p| is_order_rel(p))
                {
                    return Err("Could not merge order.json".into());
                }
            } else if is_drawio_rel(rel) {
                return Err(format!(
                    "Cannot keep both for {rel} — Draw.io diagrams must be resolved with Keep mine or Keep theirs"
                ));
            } else if is_markdown_rel(rel) {
                if !resolve_md_both(&repo, rel)? {
                    return Err(format!(
                        "Cannot keep both for {rel} (binary or delete/modify conflict)"
                    ));
                }
            } else if !resolve_path_union(&repo, rel)? {
                return Err(format!(
                    "Cannot keep both for {rel} (binary or delete/modify conflict)"
                ));
            }
        }
        _ => return Err("choice must be 'ours', 'theirs', or 'both'".into()),
    }

    let _ = auto_resolve_order_conflict(&repo)?;
    let _ = auto_resolve_delete_conflicts(&repo)?;
    let _ = auto_resolve_md_both_conflicts(&repo)?;
    if conflicted_paths(&repo).is_empty() {
        finalize_merge_commit(&repo)?;
    }

    Ok(build_status(&repo))
}

#[derive(Deserialize)]
struct GhDeviceCodeApi {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Deserialize)]
struct GhTokenApi {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[tauri::command(async)]
pub fn sync_device_flow_start(
    runtime: State<'_, SyncRuntime>,
) -> Result<DeviceCodeResponse, String> {
    let client_id = github_client_id()
        .ok_or_else(|| {
            "GitHub Device Flow is not configured. Use a Personal Access Token, or build with MARKSPACE_GITHUB_CLIENT_ID.".to_string()
        })?;

    let client = Client::new();
    let res = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .form(&[
            ("client_id", client_id),
            ("scope", "repo"),
        ])
        .send()
        .map_err(|e| format!("Device code request failed: {e}"))?;

    if !res.status().is_success() {
        return Err(format!("GitHub device code error: HTTP {}", res.status()));
    }

    let body: GhDeviceCodeApi = res
        .json()
        .map_err(|e| format!("Invalid device code response: {e}"))?;

    *runtime
        .device_code
        .lock()
        .map_err(|_| "lock poisoned".to_string())? = Some(body.device_code.clone());

    Ok(DeviceCodeResponse {
        device_code: body.device_code,
        user_code: body.user_code,
        verification_uri: body.verification_uri,
        expires_in: body.expires_in,
        interval: body.interval.max(5),
    })
}

#[tauri::command(async)]
pub fn sync_device_flow_poll(
    device_code: String,
    runtime: State<'_, SyncRuntime>,
) -> Result<DeviceTokenResponse, String> {
    let client_id = github_client_id()
        .ok_or_else(|| "GitHub Device Flow is not configured".to_string())?;

    let client = Client::new();
    let res = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .form(&[
            ("client_id", client_id),
            ("device_code", device_code.as_str()),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .send()
        .map_err(|e| format!("Token poll failed: {e}"))?;

    let body: GhTokenApi = res
        .json()
        .map_err(|e| format!("Invalid token response: {e}"))?;

    if body.access_token.is_some() {
        *runtime
            .device_code
            .lock()
            .map_err(|_| "lock poisoned".to_string())? = None;
    }

    Ok(DeviceTokenResponse {
        access_token: body.access_token,
        error: body.error,
        error_description: body.error_description,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::Signature;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn accept_both_keeps_both_hunks() {
        let raw = "\
before
<<<<<<< ours
mine line
=======
theirs line
>>>>>>> theirs
after
";
        let merged = accept_both_from_markers(raw).expect("markers");
        assert_eq!(merged, "before\nmine line\ntheirs line\nafter\n");
    }

    #[test]
    fn accept_both_none_without_markers() {
        assert!(accept_both_from_markers("plain note\n").is_none());
    }

    #[test]
    fn markdown_rel_and_drawio_rel() {
        assert!(is_markdown_rel("Note.md"));
        assert!(is_markdown_rel("folder/Note.MD"));
        assert!(!is_markdown_rel("diagram.drawio"));
        assert!(is_drawio_rel("diagram.drawio"));
        assert!(is_drawio_rel("a/b.DRAWIO"));
        assert!(!is_drawio_rel("note.md"));
    }

    fn temp_dir(name: &str) -> PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!(
            "markspace-git-sync-{name}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sig() -> Signature<'static> {
        Signature::now("Test", "test@example.com").unwrap()
    }

    fn commit_all(repo: &Repository, message: &str) {
        let mut index = repo.index().unwrap();
        index
            .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
            .unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = sig();
        let parents: Vec<git2::Commit<'_>> = match repo.head() {
            Ok(head) => vec![head.peel_to_commit().unwrap()],
            Err(_) => vec![],
        };
        let parent_refs: Vec<&git2::Commit<'_>> = parents.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs)
            .unwrap();
    }

    /// Auto Accept-Both must apply to `.md` only — never to `.drawio`.
    #[test]
    fn auto_resolve_skips_drawio_keeps_md() {
        let dir = temp_dir("drawio-skip");
        let repo = Repository::init(&dir).unwrap();
        {
            let mut cfg = repo.config().unwrap();
            cfg.set_str("user.name", "Test").unwrap();
            cfg.set_str("user.email", "test@example.com").unwrap();
        }

        fs::write(dir.join("note.md"), "base note\n").unwrap();
        fs::write(
            dir.join("diagram.drawio"),
            "<mxfile><diagram id=\"base\">base</diagram></mxfile>\n",
        )
        .unwrap();
        commit_all(&repo, "base");

        // Branch "theirs": edit both files
        repo.branch("theirs", &repo.head().unwrap().peel_to_commit().unwrap(), false)
            .unwrap();
        repo.set_head("refs/heads/theirs").unwrap();
        repo.checkout_head(Some(CheckoutBuilder::default().force()))
            .unwrap();
        fs::write(dir.join("note.md"), "theirs note\n").unwrap();
        fs::write(
            dir.join("diagram.drawio"),
            "<mxfile><diagram id=\"theirs\">theirs</diagram></mxfile>\n",
        )
        .unwrap();
        commit_all(&repo, "theirs edits");

        // Back to main / master as "ours"
        let main_name = if repo.find_branch("main", git2::BranchType::Local).is_ok() {
            "main"
        } else {
            "master"
        };
        repo.set_head(&format!("refs/heads/{main_name}")).unwrap();
        repo.checkout_head(Some(CheckoutBuilder::default().force()))
            .unwrap();
        fs::write(dir.join("note.md"), "ours note\n").unwrap();
        fs::write(
            dir.join("diagram.drawio"),
            "<mxfile><diagram id=\"ours\">ours</diagram></mxfile>\n",
        )
        .unwrap();
        commit_all(&repo, "ours edits");

        let theirs = repo
            .find_branch("theirs", git2::BranchType::Local)
            .unwrap()
            .into_reference()
            .peel_to_commit()
            .unwrap();
        let annotated = repo.find_annotated_commit(theirs.id()).unwrap();
        repo.merge(&[&annotated], None, None).unwrap();

        let before = conflicted_paths(&repo);
        assert!(
            before.iter().any(|p| p == "note.md"),
            "expected note.md conflict, got {before:?}"
        );
        assert!(
            before.iter().any(|p| p == "diagram.drawio"),
            "expected diagram.drawio conflict, got {before:?}"
        );

        let n = auto_resolve_md_both_conflicts(&repo).unwrap();
        assert!(n >= 1, "expected markdown auto-resolve");

        let after = conflicted_paths(&repo);
        assert!(
            !after.iter().any(|p| p == "note.md"),
            "note.md should be auto-resolved, still conflicted: {after:?}"
        );
        assert!(
            after.iter().any(|p| p == "diagram.drawio"),
            "diagram.drawio must remain conflicted (not auto-merged), got {after:?}"
        );

        let _ = fs::remove_dir_all(&dir);
    }
}
