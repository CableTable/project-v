use crate::grantable;
use std::{
    env, fs, io,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::Manager;

const D_EXE: &str = "ProjectD.exe";

fn is_project_d(path: &Path) -> bool {
    path.is_absolute()
        && path.file_name().is_some_and(|name| name.eq_ignore_ascii_case(D_EXE))
}

fn find_project_d(setting: &Path, local: Option<&Path>) -> io::Result<Option<PathBuf>> {
    let usable = |path: &Path| is_project_d(path) && path.is_file();
    match fs::read_to_string(setting) {
        Ok(saved) => {
            // A stale selection should prompt the user even if an installed copy exists.
            let path = PathBuf::from(saved);
            return Ok(usable(&path).then_some(path));
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    Ok(local.and_then(|root| {
        ["ProjectD", "Programs/ProjectD"]
            .into_iter()
            .map(|dir| root.join(dir).join(D_EXE))
            .find(|path| usable(path))
    }))
}

fn setting_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("project-d-path.txt"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_in_d(app: tauri::AppHandle, pdf: String) -> Result<&'static str, String> {
    if !grantable(Path::new(&pdf)) {
        return Err("Select an existing PDF on disk.".into());
    }
    let local = env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let Some(exe) =
        find_project_d(&setting_file(&app)?, local.as_deref()).map_err(|e| e.to_string())?
    else {
        return Ok("pick");
    };
    Command::new(exe)
        .arg(pdf)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok("opened")
}

#[tauri::command]
pub fn set_d_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if !is_project_d(Path::new(&path)) {
        return Err("Select ProjectD.exe using its full path.".into());
    }
    let setting = setting_file(&app)?;
    fs::create_dir_all(setting.parent().expect("settings file has a parent"))
        .and_then(|()| fs::write(setting, path))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_project_d_exe_is_accepted() {
        let dir = std::env::current_dir().unwrap();
        assert!(is_project_d(&dir.join("ProjectD.exe")));
        assert!(is_project_d(&dir.join("pROJECTd.EXE")));
        assert!(!is_project_d(&dir.join("Other.exe")));
        assert!(!is_project_d(&dir.join("ProjectD.exe.bak")));
        assert!(!is_project_d(Path::new("ProjectD.exe")));
    }

    #[test]
    fn looks_up_saved_then_local_then_programs_and_repicks_if_saved_is_gone() {
        let root = std::env::temp_dir().join(format!("pv-t3b-d-{}", std::process::id()));
        let setting = root.join("project-d-path.txt");
        let saved = root.join("ProjectD.exe");
        let local = root.join("ProjectD/ProjectD.exe");
        let programs = root.join("Programs/ProjectD/ProjectD.exe");
        let other = root.join("Other.exe");
        for exe in [&local, &programs, &saved, &other] {
            fs::create_dir_all(exe.parent().unwrap()).unwrap();
            fs::write(exe, []).unwrap();
        }
        let find = || find_project_d(&setting, Some(&root)).unwrap();
        fs::write(&setting, saved.to_str().unwrap()).unwrap();
        assert_eq!(find().as_ref(), Some(&saved));
        fs::remove_file(saved).unwrap();
        assert_eq!(find(), None);
        fs::write(&setting, other.to_str().unwrap()).unwrap();
        assert_eq!(find(), None);
        fs::remove_file(&setting).unwrap();
        assert_eq!(find().as_ref(), Some(&local));
        fs::remove_file(local).unwrap();
        assert_eq!(find().as_ref(), Some(&programs));
        fs::remove_file(programs).unwrap();
        assert_eq!(find(), None);
        fs::remove_dir_all(root).unwrap();
    }
}
