//! Apparatus desktop shell.
//!
//! The web client runs in the Tauri web view. This crate adds what the web
//! view cannot do on its own: the OS keychain, notifications, and opening a
//! URL in the default browser. Tokens live in the keychain under the
//! "apparatus" service (design spec, Security rule 9).

use keyring::{Entry, Error as KeyringError};

const SERVICE: &str = "apparatus";

/// Keys are short identifiers chosen by the web client, never user input.
fn entry(key: &str) -> Result<Entry, String> {
    let valid = !key.is_empty()
        && key.len() <= 64
        && key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-');
    if !valid {
        return Err(format!("keychain: invalid key {key:?}"));
    }
    Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

#[tauri::command]
fn keychain_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn keychain_set(key: String, value: String) -> Result<(), String> {
    entry(&key)?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn keychain_delete(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![keychain_get, keychain_set, keychain_delete])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
