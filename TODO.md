# Project V TODO

| Id | What | Status |
|----|------|--------|
| T1 | Project skeleton (repo, Tauri 2, CI, config) | done (see commit "T1: Project V skeleton") |
| T2 | Viewer core + tabs (Q13): open (dialog, drag-drop, launch args), continuous scroll rendering visible pages + 1, zoom (Ctrl+wheel, Fit width / Fit page), page box, thumbnail sidebar (F4 toggle), tab strip (Ctrl+Tab / Ctrl+W, middle-click close), dark mode; second launch opens a new tab | done (ca9acbd, 7058fdd, 5101759) |
| T3a | Find (Ctrl+F, per tab, scanned -> "no text") + recent files (last 10, reopen after restart) (grill-V-T3.md Q2-Q6) | done (4d0a2e5, fix 1806503) |
| T3b | "Open with" (Tauri fileAssociations, current user), "Open in Project D" (button + Ctrl+Shift+D), perf test (cold start < 1 s, first page < 300 ms, 1000-page scroll) (grill-V-T3b.md) | done 2026-11-18 (0190dc2 + 74903b9; node perf 1000-page load 123 ms; window timings -> T6) |
| T4 | Merge PDFs, PDF24-style (his order 2026-11-18): Merge window, add files (button + drag-drop), file list with first-page thumbnail, drag reorder / remove / sort by name, Merge -> save dialog -> one PDF (pdf-lib, grill-pdfviewer.md Q9); CI uploads ProjectV.exe as an artifact | done (37d7ece; his exe test = the real run) |
| T6 | Real-window tests after `npx tauri build --no-bundle`: Playwright attaches to ProjectV.exe's WebView2 on port 9243 and tests argv open, find, second launch/recent, merge, and Open in Project D. Merge validation: `qpdf --check` locally when found, pdf-lib page count in CI. Logs first-page and 1000-page timings. (grill-V-T6.md Q1–Q12) | done 2026-11-18 (d85d1a6; Rook window-test 10 PASS, cold start to first page 1432 ms, 1000-page open 194 ms, scroll 27 ms; Lows in rook-hq/runs49/lows.txt) |
| T5 | Merge page mode (per-page merge view) + bookmarks preserve / generate (grill-V-T5.md Q1-Q6 + Round 2) | done 5464643 |
| T7 | Zoom / pan lag on large PDFs + horizontal wheel (MX Master 3S) (grill-V-T7.md Q1-Q5 + Round 2 F1-F7) | done 833de0e (window-test --pdf: zoom step 15.9/17.1 ms, pan 16.7/18.0 ms, PASS horizontal wheel; real MX wheel unchecked) |
| T8 | Own app icon, not Project D's | done f091bae + 8334e3c (tauri icon regen) |
| T9 | CI flake: window-test "merge pages" one-shot isDisabled (CI 44236608559 attempt 1); retry waits for UI state (grill rook-hq/runs49/grill-V-T9.md) | done (King c03c350; local window-test 12 PASS, 0 FAIL) |
| T10 | Bug: MX Master 3S thumb wheel scrolls sideways a few seconds, then stops (trackpad works); after T7 (ticket T101, support/tickets.md) | done 41d4d1a (window-test 15 PASS, cargo 12 passed; grill rook-hq/runs53/grill-V-T10.md); real MX check: his (⚙ Log wheel events if it still stops) |
| T11 | Bug: Print prints the app UI and blank pages: real PDF printing, Ctrl+P + Print button (ticket T110) | done ed1f800 + fix 78cb0e2 (window-test 14 PASS on the exe; grill rook-hq/runs53/grill-V-T11.md); real print dialog run: his check |
| T12 | Open `.ai` files (PDF-compatible): Ctrl+O, drag-drop, Open with, Merge (ticket T104) | open, grill first |
| T13 | Open `.tif` / `.tiff`: Ctrl+O, drag-drop, Open with; pages scroll like PDF pages (ticket T109) | open, grill first |
| T14 | Icon without the "V": red square, white page, folded corner only (ticket T105; after T8) | open, grill first |
| T15 | Bug: switching PDF tabs shows white pages first: keep the last 5 tabs drawn, switch instantly; ⚙ toggle for less RAM (ticket T115) | done fa4ca0f (window-test 15 PASS on the exe; grill rook-hq/runs53/grill-V-T15.md) |
| T16 | Closing V with 2+ tabs open asks: Close all / Close this tab / Cancel (ticket T116) | open, grill first |
| T17 | Select and copy text: drag on text selects, Ctrl+C copies, drag on empty space pans (ticket T117) | open, grill first |
