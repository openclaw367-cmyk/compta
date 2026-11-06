//! Sidecar lifecycle: Postgres provisioning/start, backend migrate+spawn,
//! the one-time local "desktop owner" bootstrap, and graceful shutdown.
//!
//! This is the Rust translation of two already-verified prototypes —
//! desktop/postgres-prototype/provision.ps1 (initdb + durability config +
//! start, hard-kill-and-recover tested twice) and
//! desktop/node-sidecar-prototype/run-sidecar.ps1 (migrate deploy + spawn,
//! re-verified against every documented ESM-interop/native-binding risk
//! point) — not new, unverified logic. What IS new and unverified here is
//! the Rust plumbing itself; see desktop/ARCHITECTURE.md for what's
//! confirmed only against API docs so far vs. actually compiled.

use rand::{Rng, RngCore};
use serde_json::json;
use std::fs;
use std::io::{Error as IoError, ErrorKind};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::{Duration, Instant};

/// Fixed, non-5432 port — see ARCHITECTURE.md "Port and CORS" for why a
/// fixed port was chosen over dynamic negotiation for v1.
const PG_PORT: u16 = 5433;
/// Fixed backend port, matching this app's own existing dev-mode default
/// (backend/src/main.ts: `process.env.PORT ?? 3000`).
const BACKEND_PORT: u16 = 3000;

pub struct PostgresHandle {
    pub pg_bin_dir: PathBuf,
    pub data_dir: PathBuf,
    pub port: u16,
    pub password: String,
}

fn local_config_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("local-db-config.json")
}

fn jwt_secret_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(".jwt-secret")
}

fn desktop_owner_credentials_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("desktop-owner-credentials.json")
}

fn generate_local_password() -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    (0..32)
        .map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char)
        .collect()
}

fn generate_hex_secret(num_bytes: usize) -> String {
    let mut bytes = vec![0u8; num_bytes];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn other_err(msg: impl Into<String>) -> IoError {
    IoError::new(ErrorKind::Other, msg.into())
}

/// First launch: `initdb --data-checksums` + the explicit durability
/// settings verified in the Postgres prototype (fsync, synchronous_commit,
/// full_page_writes all on, loopback-only). Every later launch: just
/// starts the existing cluster, no initdb.
pub fn provision_postgres(app_data_dir: &Path, pg_bin_dir: &Path) -> std::io::Result<PostgresHandle> {
    let data_dir = app_data_dir.join("pgdata");
    let log_dir = app_data_dir.join("logs");
    fs::create_dir_all(&log_dir)?;

    let initdb = pg_bin_dir.join("initdb.exe");
    let pg_ctl = pg_bin_dir.join("pg_ctl.exe");

    let first_launch = !data_dir.join("PG_VERSION").exists();

    let password = if first_launch {
        let password = generate_local_password();
        let pw_file = app_data_dir.join(".pg-init-pw.tmp");
        fs::write(&pw_file, &password)?;

        let status = Command::new(&initdb)
            .arg("-D")
            .arg(&data_dir)
            .arg("-U")
            .arg("postgres")
            .arg("-A")
            .arg("scram-sha-256")
            .arg(format!("--pwfile={}", pw_file.display()))
            .arg("-E")
            .arg("UTF8")
            .arg("--locale=C")
            .arg("--data-checksums")
            .status()?;
        let _ = fs::remove_file(&pw_file);
        if !status.success() {
            return Err(other_err("initdb failed"));
        }

        // Explicit, not trusted to defaults — see the Postgres prototype's
        // own README for why each of these is load-bearing for crash
        // recovery specifically, not just "safe defaults."
        let conf_path = data_dir.join("postgresql.conf");
        let durability_conf = format!(
            "\n# --- Citaledge desktop durability config (explicit, not defaults) ---\n\
             listen_addresses = '127.0.0.1'\n\
             port = {PG_PORT}\n\
             fsync = on\n\
             synchronous_commit = on\n\
             full_page_writes = on\n\
             wal_level = replica\n"
        );
        let mut existing = fs::read_to_string(&conf_path)?;
        existing.push_str(&durability_conf);
        fs::write(&conf_path, existing)?;

        let config = json!({ "password": password, "port": PG_PORT });
        fs::write(local_config_path(app_data_dir), serde_json::to_string_pretty(&config)?)?;
        password
    } else {
        let raw = fs::read_to_string(local_config_path(app_data_dir))?;
        let parsed: serde_json::Value = serde_json::from_str(&raw)?;
        parsed["password"]
            .as_str()
            .ok_or_else(|| other_err("local-db-config.json missing password"))?
            .to_string()
    };

    let log_file = log_dir.join("postgres.log");
    let status = Command::new(&pg_ctl)
        .arg("start")
        .arg("-D")
        .arg(&data_dir)
        .arg("-l")
        .arg(&log_file)
        .arg("-w")
        .arg("-t")
        .arg("30")
        .status()?;
    if !status.success() {
        return Err(other_err("pg_ctl start failed"));
    }

    Ok(PostgresHandle {
        pg_bin_dir: pg_bin_dir.to_path_buf(),
        data_dir,
        port: PG_PORT,
        password,
    })
}

/// Runs `prisma migrate deploy` then spawns the compiled backend as a
/// long-lived child. Every env var is set to an ABSOLUTE path — see
/// desktop/node-sidecar-prototype/README.md's own finding that
/// DOCUMENT_STORAGE_DIR's documented default is CWD-relative and must
/// never be left on that default in a packaged app.
pub fn spawn_backend(app_data_dir: &Path, backend_dir: &Path, pg: &PostgresHandle) -> std::io::Result<Child> {
    let node_exe = backend_dir.join("node.exe");
    let main_js = backend_dir.join("dist").join("src").join("main.js");
    let prisma_cli = backend_dir
        .join("node_modules")
        .join("prisma")
        .join("build")
        .join("index.js");
    let schema_path = backend_dir.join("prisma").join("schema.prisma");
    let pg_dump = pg.pg_bin_dir.join("pg_dump.exe");
    let createdb = pg.pg_bin_dir.join("createdb.exe");

    let database_url = format!(
        "postgresql://postgres:{}@127.0.0.1:{}/citaledge?schema=public",
        pg.password, pg.port
    );

    let document_storage_dir = app_data_dir.join("documents");
    fs::create_dir_all(&document_storage_dir)?;

    // initdb only creates the bootstrap postgres/template1 databases —
    // create the app's own database before migrating. Ignored on
    // failure: harmless if it already exists from a prior launch.
    let _ = Command::new(&createdb)
        .arg("-h")
        .arg("127.0.0.1")
        .arg("-p")
        .arg(pg.port.to_string())
        .arg("-U")
        .arg("postgres")
        .arg("citaledge")
        .env("PGPASSWORD", &pg.password)
        .status();

    let migrate_status = Command::new(&node_exe)
        .arg(&prisma_cli)
        .arg("migrate")
        .arg("deploy")
        .arg(format!("--schema={}", schema_path.display()))
        .env("DATABASE_URL", &database_url)
        .status()?;
    if !migrate_status.success() {
        return Err(other_err("prisma migrate deploy failed"));
    }

    let jwt_secret = read_or_create_secret(&jwt_secret_path(app_data_dir), 32)?;

    let child = Command::new(&node_exe)
        .arg(&main_js)
        .env("DATABASE_URL", &database_url)
        .env("PORT", BACKEND_PORT.to_string())
        .env("JWT_ACCESS_SECRET", jwt_secret)
        // ⚠️ NOT YET LIVE-CONFIRMED — see ARCHITECTURE.md "Open item:
        // confirm the real webview origin". https://tauri.localhost is
        // Tauri v2's documented Windows/WebView2 convention; verify
        // against window.location.origin on the first real build and
        // correct this if it differs.
        .env("FRONTEND_ORIGIN", "https://tauri.localhost")
        .env("MAILER_PROVIDER", "console")
        .env("PG_DUMP_PATH", &pg_dump)
        .env("DOCUMENT_STORAGE_DIR", &document_storage_dir)
        .spawn()?;

    Ok(child)
}

fn read_or_create_secret(path: &Path, num_bytes: usize) -> std::io::Result<String> {
    if let Ok(existing) = fs::read_to_string(path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    let secret = generate_hex_secret(num_bytes);
    fs::write(path, &secret)?;
    Ok(secret)
}

pub fn wait_for_backend_ready(timeout: Duration) -> std::io::Result<()> {
    let deadline = Instant::now() + timeout;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(other_err)?;
    loop {
        if client
            .get(format!("http://127.0.0.1:{BACKEND_PORT}/docs"))
            .send()
            .is_ok()
        {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(other_err("backend did not become ready in time"));
        }
        std::thread::sleep(Duration::from_millis(300));
    }
}

/// First launch only, and only after the backend is confirmed ready: one
/// local user + one default company, via the real, UNMODIFIED
/// `POST /auth/signup` — never a privileged bootstrap path. Resolves a
/// real requirement: `GET /backup/export` (the shutdown backup call
/// below) is gated on the caller owning at least one company, so SOME
/// authenticated identity that owns a company must exist before shutdown
/// can ever back anything up.
///
/// ⚠️ Deliberately narrow, and the human-facing half is NOT solved here —
/// see ARCHITECTURE.md "Carried over to the onboarding wizard stage" for
/// the frontend's own still-needed auto-login step, which reads this same
/// credentials file via a small Tauri command not yet written.
pub fn bootstrap_desktop_owner(app_data_dir: &Path) -> std::io::Result<()> {
    let path = desktop_owner_credentials_path(app_data_dir);
    if path.exists() {
        return Ok(());
    }

    let password = generate_local_password();
    let email = format!("owner-{}@citaledge.local", generate_hex_secret(4));

    let client = reqwest::blocking::Client::new();
    let resp = client
        .post(format!("http://127.0.0.1:{BACKEND_PORT}/auth/signup"))
        .json(&json!({
            "email": email,
            "password": password,
            // A real, renameable company (CompanyProfilePage already
            // supports this) — not a throwaway. The onboarding wizard's
            // own "create or import your first company" step (stage 4)
            // acts on THIS company, it does not create a second one.
            "companyName": "Ma société",
        }))
        .send()
        .map_err(other_err)?;
    if !resp.status().is_success() {
        return Err(other_err(format!("desktop owner signup failed: {}", resp.status())));
    }

    let creds = json!({ "email": email, "password": password });
    fs::write(&path, serde_json::to_string_pretty(&creds)?)?;
    Ok(())
}

fn login_for_shutdown_backup(app_data_dir: &Path) -> Option<String> {
    let raw = fs::read_to_string(desktop_owner_credentials_path(app_data_dir)).ok()?;
    let creds: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .ok()?;
    let resp = client
        .post(format!("http://127.0.0.1:{BACKEND_PORT}/auth/login"))
        .json(&json!({ "email": creds["email"], "password": creds["password"] }))
        .send()
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let body: serde_json::Value = resp.json().ok()?;
    body["accessToken"].as_str().map(str::to_string)
}

/// The graceful-shutdown sequence verified in
/// desktop/postgres-prototype/run-crash-test.ps1 step 9: a final backup
/// BEFORE stopping (best-effort — a company may not exist yet on a very
/// first run, or the backend may already be gone; either way this must
/// never block shutdown), then kill the backend, then `pg_ctl stop -m
/// fast` for a clean shutdown checkpoint.
pub fn graceful_shutdown(app_data_dir: &Path, pg: &PostgresHandle, backend_child: &mut Option<Child>) {
    if let Some(token) = login_for_shutdown_backup(app_data_dir) {
        if let Ok(client) = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
        {
            let _ = client
                .get(format!("http://127.0.0.1:{BACKEND_PORT}/backup/export"))
                .bearer_auth(token)
                .send();
        }
    }

    if let Some(mut child) = backend_child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }

    let pg_ctl = pg.pg_bin_dir.join("pg_ctl.exe");
    let _ = Command::new(&pg_ctl)
        .arg("stop")
        .arg("-D")
        .arg(&pg.data_dir)
        .arg("-m")
        .arg("fast")
        .arg("-w")
        .arg("-t")
        .arg("30")
        .status();
}
