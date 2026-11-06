// Suppresses the console window in release builds on Windows — standard
// Tauri boilerplate, not specific to this app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod provisioning;

use provisioning::PostgresHandle;
use std::process::Child;
use std::sync::Mutex;
use std::time::Duration;
use tauri::path::BaseDirectory;
use tauri::{Manager, RunEvent};

struct BackendChild(Mutex<Option<Child>>);

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("could not resolve app data directory");
            std::fs::create_dir_all(&app_data_dir).expect("could not create app data directory");

            // Bundled via tauri.conf.json's bundle.resources — whole
            // directories, original filenames preserved, which matters
            // because pg_ctl/postgres.exe/initdb.exe expect to find each
            // other as siblings in the same bin/ folder. See
            // ARCHITECTURE.md "Why bundle.resources, not externalBin, for
            // Postgres" for why externalBin's single-file/renaming model
            // doesn't fit Postgres's own binaries.
            let pg_bin_dir = app
                .path()
                .resolve("resources/postgres/bin", BaseDirectory::Resource)
                .expect("could not resolve bundled postgres/bin resource");
            let backend_dir = app
                .path()
                .resolve("resources/backend", BaseDirectory::Resource)
                .expect("could not resolve bundled backend resource");

            let pg = provisioning::provision_postgres(&app_data_dir, &pg_bin_dir)
                .expect("Postgres provisioning failed");

            let backend_child = provisioning::spawn_backend(&app_data_dir, &backend_dir, &pg)
                .expect("failed to launch backend sidecar");

            provisioning::wait_for_backend_ready(Duration::from_secs(30))
                .expect("backend did not become ready");

            provisioning::bootstrap_desktop_owner(&app_data_dir)
                .expect("desktop owner bootstrap failed");

            app.manage(pg);
            app.manage(BackendChild(Mutex::new(Some(backend_child))));

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { api, .. } = event {
            // Stop Tauri's own exit so the cleanup below (a real HTTP
            // round trip plus a Postgres stop) can finish first — see
            // the App::run docs' own documented pattern for this. We
            // exit the process ourselves, explicitly, once done.
            api.prevent_exit();

            let app_data_dir = app_handle
                .path()
                .app_data_dir()
                .expect("could not resolve app data directory during shutdown");
            let pg = app_handle.state::<PostgresHandle>();
            let backend = app_handle.state::<BackendChild>();
            let mut child_slot = backend.0.lock().expect("backend child mutex poisoned");

            provisioning::graceful_shutdown(&app_data_dir, &pg, &mut child_slot);

            std::process::exit(0);
        }
    });
}
