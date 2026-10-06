# G1-B Tauri shell prototype

This is a route-comparison prototype, not the product application. It contains a single Tauri window with a synthetic summary, one in-memory input panel, a native tray menu, and single-instance forwarding. It has no network client, AI provider, clipboard access, or autostart.

## Local toolchain

Rustup, Cargo, and the pinned Rust 1.98.1 MSVC toolchain are stored under the ignored `.tools/` directory. Commands that build Rust call `run-msvc.cmd`; it uses process-local `RUSTUP_HOME`, `CARGO_HOME`, and `RUSTUP_TOOLCHAIN`, then imports the installed Visual C++ environment. Set `G1B_VCVARS64` for a non-default `vcvars64.bat` path.

## Commands

Run from this directory:

```powershell
npm ci --no-audit --no-fund
npm run typecheck
npm test -- --run
npm run build
.\run-msvc.cmd cargo fmt --manifest-path src-tauri/Cargo.toml --check
.\run-msvc.cmd cargo test --manifest-path src-tauri/Cargo.toml --locked
.\run-msvc.cmd cargo check --manifest-path src-tauri/Cargo.toml --locked
.\run-msvc.cmd npm run tauri -- build --no-bundle
```

The release executable is produced under `src-tauri/target/release/`. This prototype has no bundle or installer; `--no-bundle` intentionally verifies the release application executable only.
