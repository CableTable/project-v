// No console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod launch;
use std::{path::PathBuf, sync::Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_fs::FsExt;

struct LaunchFiles(Mutex<Vec<PathBuf>>);

/// The web takes the queued launch paths. Each one is added to the fs scope so the web can read exactly
/// those files (the Open dialog does the same for the file picked); nothing else is readable.
#[tauri::command]
fn take_launch_files(app: tauri::AppHandle, files: tauri::State<LaunchFiles>) -> Vec<PathBuf> {
    let paths = std::mem::take(&mut *files.0.lock().unwrap());
    for path in &paths {
        let _ = app.fs_scope().allow_file(path); // a missing path stays out; the web reports it
    }
    paths
}

fn main() {
    let cwd = std::env::current_dir().expect("could not read launch directory");
    tauri::Builder::default()
        .manage(LaunchFiles(Mutex::new(launch::file_paths(std::env::args(), &cwd))))
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let paths = launch::file_paths(args, std::path::Path::new(&cwd));
            app.state::<LaunchFiles>().0.lock().unwrap().extend(paths);
            // Keep paths queued if the web listener has not loaded yet.
            let _ = app.emit("open-launch-files", ());
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![take_launch_files])
        .run(tauri::generate_context!())
        .expect("error while running Project V");
}
