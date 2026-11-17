# Project V TODO

| Id | What | Status |
|----|------|--------|
| T1 | Project skeleton (repo, Tauri 2, CI, config) | done (see commit "T1: Project V skeleton") |
| T2 | Viewer core + tabs (Q13): open (dialog, drag-drop, launch args), continuous scroll rendering visible pages + 1, zoom (Ctrl+wheel, Fit width / Fit page), page box, thumbnail sidebar (F4 toggle), tab strip (Ctrl+Tab / Ctrl+W, middle-click close), dark mode; second launch opens a new tab | open |
| T3 | Find (Ctrl+F), recent files, "Open with" (HKCU installer entry), "Open in Project D" (button + Ctrl+Shift+D), perf test (cold start < 1 s, first page < 300 ms, 1000-page scroll) | open |
| T4 | Merge PDFs, PDF24-style (his order 2026-11-18): Merge window, add files (button + drag-drop), file list with first-page thumbnail, drag reorder / remove / sort by name, Merge -> save dialog -> one PDF (pdf-lib, grill-pdfviewer.md Q9); CI uploads ProjectV.exe as an artifact | open |
