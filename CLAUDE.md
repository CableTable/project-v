# Project V

A fast, simple PDF viewer: its own small exe, next to Project D. Scope, targets and decisions: `E:/Project B/Claude/rook-hq/runs49/grill-pdfviewer.md` (Q1-Q14). Board: `mockups/V1_Viewer.html` (still in Project D's `mockups/`; moving it here is not done).

- **Stack:** Tauri 2 (`src-tauri/`, exe `ProjectV.exe`, same versions as Project D) + pdf.js vendored in `web/vendor/pdfjs`. Plain JS modules in `web/`, no bundler.
- **No admin, ever:** per-user NSIS install (`currentUser`), nothing may need admin.
- **Commands:** `npm test` (node --test `*.test.mjs`), `npx tauri build --debug` (needs the Rust toolchain), `cargo test --manifest-path src-tauri/Cargo.toml`.
- **Tools on this PC (2026-11-18):** Rust MSVC in `E:\Softwares\rust`, VS Build Tools in `E:\Softwares\VSBuildTools`, qpdf in `E:\Softwares\qpdf\qpdf-12.4.2-msvc64\bin`. In Git Bash, if `cargo` is not found: `export CARGO_HOME='E:\Softwares\rust\cargo' RUSTUP_HOME='E:\Softwares\rust\rustup'; PATH="/e/Softwares/rust/cargo/bin:$PATH"`. Local exe: `npx tauri build --no-bundle` -> `src-tauri/target/release/ProjectV.exe` (~5 min; CI does the same). A merged or written PDF is checked with `qpdf --check <file>` (prints "No syntax or stream encoding errors found").
- Text from a file never reaches HTML unescaped: `textContent`, never `innerHTML`.
- Work is in `TODO.md`.
