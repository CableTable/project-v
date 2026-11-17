# Project V

A fast, simple PDF viewer: its own small exe, next to Project D. Scope, targets and decisions: `E:/Project B/Claude/rook-hq/runs49/grill-pdfviewer.md` (Q1-Q14). Board: `mockups/V1_Viewer.html` (still in Project D's `mockups/`; moving it here is not done).

- **Stack:** Tauri 2 (`src-tauri/`, exe `ProjectV.exe`, same versions as Project D) + pdf.js vendored in `web/vendor/pdfjs`. Plain JS modules in `web/`, no bundler.
- **No admin, ever:** per-user NSIS install (`currentUser`), nothing may need admin.
- **Commands:** `npm test` (node --test `*.test.mjs`), `npx tauri build --debug` (needs the Rust toolchain), `cargo test --manifest-path src-tauri/Cargo.toml`.
- Text from a file never reaches HTML unescaped: `textContent`, never `innerHTML`.
- Work is in `TODO.md`.
