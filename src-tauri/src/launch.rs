use std::path::{Path, PathBuf};

/// Launch argv -> file paths: skips the exe and flags, keeps missing paths (the web reports them).
pub fn file_paths(args: impl IntoIterator<Item = String>, cwd: &Path) -> Vec<PathBuf> {
    args.into_iter()
        .skip(1)
        .filter(|arg| !arg.is_empty() && !arg.starts_with('-'))
        .map(|arg| cwd.join(arg))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_executable_and_flags_but_keeps_missing_paths() {
        let cwd = std::env::current_dir().unwrap();
        let args = vec!["ProjectV.exe".into(), "--debug".into(), "".into(), "a b.pdf".into()];
        assert_eq!(file_paths(args, &cwd), vec![cwd.join("a b.pdf")]);
    }
}
