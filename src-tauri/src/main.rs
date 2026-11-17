// No console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod launch;
mod project_d;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Emitter, Manager};
use tauri_plugin_fs::FsExt;

struct LaunchFiles(Mutex<Vec<PathBuf>>);

/// The web takes the queued launch paths. Each one is added to the fs scope so the web can read exactly
/// those files (the Open dialog does the same for the file picked); nothing else is readable.
#[tauri::command]
fn take_launch_files(app: tauri::AppHandle, files: tauri::State<LaunchFiles>) -> Vec<PathBuf> {
    let paths = std::mem::take(&mut *files.0.lock().unwrap());
    grant_launch_paths(&paths, |path| {
        let _ = app.fs_scope().allow_file(path);
    });
    paths
}

fn grant_launch_paths(paths: &[PathBuf], mut allow: impl FnMut(&Path)) {
    for path in paths.iter().filter(|path| grantable(path)) {
        allow(path);
    }
}

/// Only an existing absolute .pdf file may get an fs scope grant.
fn grantable(path: &Path) -> bool {
    path.is_absolute()
        && path.is_file()
        && path.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf"))
}

#[tauri::command]
fn reopen_path(app: tauri::AppHandle, path: PathBuf) -> bool {
    grantable(&path) && app.fs_scope().allow_file(&path).is_ok()
}

const TEST_DIR_ENV: &str = "PROJECTV_TEST_DIR";

#[tauri::command]
fn test_dir() -> Option<PathBuf> {
    std::env::var_os(TEST_DIR_ENV).map(PathBuf::from)
}

fn test_root() -> Result<Option<PathBuf>, String> {
    match test_dir() {
        Some(dir) if dir.is_relative() => std::env::current_dir()
            .map(|cwd| Some(cwd.join(dir)))
            .map_err(|e| e.to_string()),
        dir => Ok(dir),
    }
}

#[tauri::command]
fn test_merge_inputs(app: tauri::AppHandle) -> Result<Option<Vec<PathBuf>>, String> {
    let Some(dir) = test_root()? else { return Ok(None) };
    let scope = app.fs_scope();
    let mut paths = Vec::new();
    for entry in fs::read_dir(dir.join("in")).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if grantable(&path) {
            scope.allow_file(&path).map_err(|e| e.to_string())?;
            paths.push(path);
        }
    }
    paths.sort();
    Ok(Some(paths))
}

#[tauri::command]
fn test_merge_target(app: tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    let Some(dir) = test_root()? else { return Ok(None) };
    let out = dir.join("out");
    fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let target = out.join("merged.pdf");
    app.fs_scope().allow_file(&target).map_err(|e| e.to_string())?;
    Ok(Some(target))
}

#[cfg(test)]
mod tests {
    use super::{grant_launch_paths, grantable, launch, test_dir, TEST_DIR_ENV};
    use std::{env, path::PathBuf};

    #[test]
    fn test_dir_is_opt_in() {
        let before = env::var_os(TEST_DIR_ENV);
        let dir = env::temp_dir().join("pv-t6");
        env::remove_var(TEST_DIR_ENV);
        let unset = test_dir();
        env::set_var(TEST_DIR_ENV, &dir);
        let set = test_dir();
        match before {
            Some(value) => env::set_var(TEST_DIR_ENV, value),
            None => env::remove_var(TEST_DIR_ENV),
        }
        assert_eq!(unset, None);
        assert_eq!(set, Some(dir));
    }

    fn temp_file(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("pv-t3a-{}", name));
        std::fs::write(&p, b"x").unwrap();
        p
    }

    #[test]
    fn existing_pdf_any_case_is_grantable() {
        assert!(grantable(&temp_file("a.pdf")));
        assert!(grantable(&temp_file("b.PDF")));
    }

    #[test]
    fn other_extensions_are_refused() {
        assert!(!grantable(&temp_file("a.pdf.exe")));
        assert!(!grantable(&temp_file("a.txt")));
        assert!(!grantable(&temp_file("noext")));
    }

    #[test]
    fn launch_only_grants_existing_pdfs() {
        let pdf = temp_file("launch.pdf");
        let txt = temp_file("launch.txt");
        let cwd = pdf.parent().unwrap();
        let args = [
            "ProjectV.exe",
            txt.file_name().unwrap().to_str().unwrap(),
            "pv-t3b-missing-launch.pdf",
            pdf.file_name().unwrap().to_str().unwrap(),
        ];
        let paths = launch::file_paths(args.map(str::to_owned), cwd);
        let mut granted = Vec::new();
        grant_launch_paths(&paths, |path| granted.push(path.to_path_buf()));
        std::fs::remove_file(&txt).unwrap();
        std::fs::remove_file(&pdf).unwrap();
        assert_eq!(
            granted,
            vec![pdf],
            "only the existing PDF may get a launch grant"
        );
    }

    #[test]
    fn relative_directory_and_missing_are_refused() {
        std::fs::write("pv-t3a-rel.pdf", b"x").unwrap();
        assert!(!grantable(std::path::Path::new("pv-t3a-rel.pdf")));
        std::fs::remove_file("pv-t3a-rel.pdf").unwrap();
        let dir = std::env::temp_dir().join("pv-t3a-dir.pdf");
        std::fs::create_dir_all(&dir).unwrap();
        assert!(!grantable(&dir));
        assert!(!grantable(&std::env::temp_dir().join("pv-t3a-missing.pdf")));
        assert!(!grantable(std::path::Path::new(r"C:\pv-t3a-missing.PDF")));
    }
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
        .invoke_handler(tauri::generate_handler![
            take_launch_files,
            reopen_path,
            test_dir,
            test_merge_inputs,
            test_merge_target,
            project_d::open_in_d,
            project_d::set_d_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running Project V");
}
