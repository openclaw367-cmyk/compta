# Desktop launcher

A "Citaledge" desktop shortcut that starts both dev servers (if they
aren't already running) and opens the app in your default browser — no
need to open two terminals and run `npm run start:dev` / `npm run dev`
by hand.

## Files

- `launch-citaledge.ps1` — the actual launcher. Starts the backend
  (`npm run start:dev`, port 3000) and frontend (`npm run dev`, port
  5173) each in their own minimized, titled console window if that
  port isn't already listening, waits for the frontend to respond, then
  opens `http://localhost:5173`.
- `install-desktop-shortcut.ps1` — creates (or re-creates) the
  `Citaledge.lnk` shortcut on your Desktop, pointing at
  `launch-citaledge.ps1` and using `citadel.ico` as its icon.
- `citadel.ico` — the app's brand mark (see
  `frontend/src/components/layout/icons.tsx`'s `IconCitadel`), baked
  into a multi-resolution `.ico` for the shortcut/taskbar.

## Re-installing the shortcut

If you move the repo to a different folder, or the Desktop shortcut
gets deleted, just re-run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\desktop\install-desktop-shortcut.ps1
```

It always points at wherever this copy of the repo actually lives —
nothing is hardcoded to a specific path.

## Stopping the servers

Closing either minimized console window (or Ctrl+C inside it, or ending
the task in Task Manager) stops that dev server, exactly like closing a
terminal you'd started it in by hand.

## A note for anyone editing these scripts

Both `.ps1` files are plain ASCII on purpose. Windows PowerShell 5.1
(`powershell.exe`, as opposed to `pwsh.exe`) reads a script with no
UTF-8 BOM using the system codepage — a French accented character here
can silently corrupt a string literal a few lines later and throw a
confusing parse error. Keep user-facing text in the React app instead,
where UTF-8 is handled correctly.
