# Project V TODO

| Id | What | Status |
|----|------|--------|
| T1 | Project skeleton (repo, Tauri 2, CI, config) | done (see commit "T1: Project V skeleton") |
| T2 | Viewer core + tabs (Q13): open (dialog, drag-drop, launch args), continuous scroll rendering visible pages + 1, zoom (Ctrl+wheel, Fit width / Fit page), page box, thumbnail sidebar (F4 toggle), tab strip (Ctrl+Tab / Ctrl+W, middle-click close), dark mode; second launch opens a new tab | done (ca9acbd, 7058fdd, 5101759) |
| T3a | Find (Ctrl+F, per tab, scanned -> "no text") + recent files (last 10, reopen after restart) (grill-V-T3.md Q2-Q6) | done (4d0a2e5, fix 1806503) |
| T3b | "Open with" (Tauri fileAssociations, current user), "Open in Project D" (button + Ctrl+Shift+D), perf test (cold start < 1 s, first page < 300 ms, 1000-page scroll) (grill-V-T3b.md) | open |
| T4 | Merge PDFs, PDF24-style (his order 2026-11-18): Merge window, add files (button + drag-drop), file list with first-page thumbnail, drag reorder / remove / sort by name, Merge -> save dialog -> one PDF (pdf-lib, grill-pdfviewer.md Q9); CI uploads ProjectV.exe as an artifact | done (37d7ece; his exe test = the real run) |
| T6 | Real-window tests: Playwright (as in Project D) attaches to ProjectV.exe's WebView2 over a debug port (WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS) and runs open / find / recent / merge steps; merged output checked with qpdf --check (his "All" 2026-11-18). Grill first | open |
| T5 | Merge page mode (per-page merge view) + bookmarks preserve / generate (grill-V-T4.md Q2, Q5) | open |
