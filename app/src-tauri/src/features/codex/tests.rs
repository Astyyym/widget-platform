use super::runtime::{CodexRefreshSchedule, CodexRuntime, DEFAULT_REFRESH_INTERVAL};
use super::transport::{CodexAppServerClient, CodexAppServerConfig};
use std::time::{Duration, Instant};

#[test]
#[ignore = "requires explicit WIDGET_CODEX_DISCOVERY=1; path-only local discovery, no quota request"]
fn local_installed_client_is_discovered_without_a_test_override() {
    assert_eq!(std::env::var("WIDGET_CODEX_DISCOVERY").as_deref(), Ok("1"));
    assert!(std::env::var_os("WIDGET_CODEX_CLI_PATH").is_none());
    assert!(CodexAppServerConfig::from_environment().is_ok(), "ordinary installed launch must discover its native client without an injected test variable");
}

#[test]
fn refresh_schedule_resets_after_success_and_backs_off_after_failures() {
    let start = Instant::now();
    let mut schedule = CodexRefreshSchedule::default();
    assert_eq!(DEFAULT_REFRESH_INTERVAL, Duration::from_secs(180));

    assert_eq!(schedule.delay_until_next(start), None);
    schedule.record_success(start);
    assert_eq!(
        schedule.delay_until_next(start),
        Some(DEFAULT_REFRESH_INTERVAL)
    );

    let first_failure = start + DEFAULT_REFRESH_INTERVAL;
    schedule.record_failure(first_failure);
    assert_eq!(
        schedule.delay_until_next(first_failure),
        Some(DEFAULT_REFRESH_INTERVAL)
    );
    schedule.record_failure(first_failure + DEFAULT_REFRESH_INTERVAL);
    assert_eq!(
        schedule.delay_until_next(first_failure + DEFAULT_REFRESH_INTERVAL),
        Some(DEFAULT_REFRESH_INTERVAL * 2)
    );

    let recovered = first_failure + DEFAULT_REFRESH_INTERVAL * 3;
    schedule.record_success(recovered);
    assert_eq!(
        schedule.delay_until_next(recovered),
        Some(DEFAULT_REFRESH_INTERVAL)
    );
}

#[test]
fn runtime_enforces_backoff_and_exposes_cancellation() {
    let runtime = CodexRuntime::new();
    let ticket = runtime.begin().expect("first refresh may start");
    let cancellation = ticket.cancellation();
    assert!(runtime.cancel_active());
    assert!(cancellation.load(std::sync::atomic::Ordering::SeqCst));
    ticket.complete(false);

    let error = runtime
        .begin()
        .err()
        .expect("failed refresh must enter backoff");
    assert_eq!(error.code, "refreshNotDue");
    let retry_after_ms = error.retry_after_ms.expect("retry delay is available");
    assert!((179_000..=180_000).contains(&retry_after_ms));
}

#[test]
fn dropped_command_guard_cancels_without_releasing_the_worker_slot() {
    let runtime = CodexRuntime::new();
    let ticket = runtime.begin().expect("first refresh may start");
    let cancellation = ticket.cancellation();
    let cancellation_guard = ticket.cancellation_guard();

    drop(cancellation_guard);

    assert!(cancellation.load(std::sync::atomic::Ordering::SeqCst));
    let error = runtime
        .begin()
        .err()
        .expect("worker slot remains occupied until the child is reaped");
    assert_eq!(error.code, "refreshInProgress");
    ticket.complete(false);
}

#[cfg(target_os = "windows")]
mod process_tests {
    use super::*;
    use crate::features::codex::transport::ProcessGuard;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::Arc;
    use std::thread;

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "widget-platform-g5-b-{}-{sequence}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create isolated Codex transport test directory");
            Self(path)
        }

        fn script(&self) -> PathBuf {
            self.0.join("fake-app-server.ps1")
        }

        fn marker(&self) -> PathBuf {
            self.0.join("server-marker.txt")
        }

        fn codex_home(&self) -> PathBuf {
            self.0.join("codex-home")
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn discovery_uses_a_versioned_desktop_binary_without_an_override() {
        let directory = TestDirectory::new();
        let bin = directory.0.join("OpenAI/Codex/bin/version/codex.exe");
        fs::create_dir_all(bin.parent().unwrap()).unwrap();
        fs::write(&bin, b"synthetic binary; never executed").unwrap();
        assert_eq!(
            super::super::transport::resolve_codex_executable(None, Some(directory.0.clone()), &[])
                .unwrap(),
            bin
        );
    }

    #[test]
    fn explicit_invalid_override_does_not_silently_fall_back_to_path() {
        let directory = TestDirectory::new();
        fs::write(directory.0.join("codex.exe"), b"synthetic; never executed").unwrap();
        let error = super::super::transport::resolve_codex_executable(
            Some(PathBuf::from("relative/codex.exe")),
            None,
            &[directory.0.clone()],
        )
        .unwrap_err();
        assert_eq!(error.code, "configurationError");
    }

    #[test]
    fn discovery_accepts_native_path_exe_but_not_shell_shims_or_cwd() {
        let directory = TestDirectory::new();
        fs::write(directory.0.join("codex.cmd"), b"synthetic; never executed").unwrap();
        assert!(super::super::transport::resolve_codex_executable(
            None,
            None,
            &[directory.0.clone()]
        )
        .is_err());
        fs::write(directory.0.join("codex.exe"), b"synthetic; never executed").unwrap();
        assert_eq!(
            super::super::transport::resolve_codex_executable(None, None, &[directory.0.clone()])
                .unwrap(),
            directory.0.join("codex.exe")
        );
        assert!(super::super::transport::resolve_codex_executable(
            None,
            None,
            &[PathBuf::from(".")]
        )
        .is_err());
    }

    const FAKE_SERVER: &str = r#"
$ErrorActionPreference = 'Stop'
$mode = $args[0]
$marker = $args[1]
$expectedHome = $args[2]
$stage = 0
while ($null -ne ($line = [Console]::In.ReadLine())) {
  try { $request = $line | ConvertFrom-Json -ErrorAction Stop }
  catch { [Console]::Out.WriteLine('{"id":1,"error":{"code":-32600,"message":"invalid synthetic request"}}'); continue }
  if ($request.method -eq 'initialize') {
    $stage = 1
    if ([Environment]::GetEnvironmentVariable('CODEX_HOME') -ne $expectedHome -or
        [Environment]::GetEnvironmentVariable('OPENAI_API_KEY') -or
        [Environment]::GetEnvironmentVariable('CODEX_API_KEY') -or
        [Environment]::GetEnvironmentVariable('OPENAI_BASE_URL')) {
      [Console]::Out.WriteLine('{"id":1,"error":{"code":-32600,"message":"unsafe synthetic environment"}}')
      [Console]::Out.Flush()
      continue
    }
    if (-not $request.params.capabilities.explicitGatewayOauth -or
        $request.params.capabilities.optOutNotificationMethods -notcontains 'account/gatewayOAuth/changed' -or
        $request.params.capabilities.optOutNotificationMethods -notcontains 'account/rateLimits/updated') {
      [Console]::Out.WriteLine('{"id":1,"error":{"code":-32600,"message":"missing safe capabilities"}}')
      [Console]::Out.Flush()
      continue
    }
    if ($mode -eq 'timeout' -or $mode -eq 'cancel') {
      [System.IO.File]::WriteAllText($marker, 'ready')
      Start-Sleep -Seconds 30
      continue
    }
    if ($mode -eq 'output-limit') {
      [Console]::Out.Write(('x' * 8192))
      [Console]::Out.Flush()
      continue
    }
    if ($mode -eq 'output-total-limit') {
      for ($i = 0; $i -lt 100; $i++) {
        [Console]::Out.WriteLine('{"method":"synthetic/notice","params":{}}')
      }
      [Console]::Out.Flush()
      continue
    }
    if ($mode -eq 'server-request') {
      [Console]::Out.WriteLine('{"id":77,"method":"account/gatewayOAuth/login","params":{}}')
      [Console]::Out.Flush()
      continue
    }
    [Console]::Out.WriteLine('{"method":"account/rateLimits/updated","params":{}}')
    [Console]::Out.WriteLine('{"id":1,"result":{}}')
    [Console]::Out.Flush()
    continue
  }
  if ($request.method -eq 'initialized') {
    if ($stage -ne 1) { continue }
    $stage = 2
    continue
  }
  if ($request.method -eq 'account/gatewayOAuth/read') {
    if ($stage -ne 2) { [Console]::Out.WriteLine('{"id":2,"error":{"code":-32600,"message":"wrong order"}}'); continue }
    $stage = 3
    if ($mode -eq 'gateway-not-ready') {
      [Console]::Out.WriteLine('{"id":2,"result":{"required":true,"status":"notReady"}}')
    } else {
      [Console]::Out.WriteLine('{"id":2,"result":{"required":false,"status":null,"providerName":"PRIVATE_MARKER"}}')
    }
    [Console]::Out.Flush()
    continue
  }
  if ($request.method -eq 'account/rateLimits/read') {
    if ($stage -ne 3) { [Console]::Out.WriteLine('{"id":3,"error":{"code":-32600,"message":"gateway read required"}}'); continue }
    [System.IO.File]::AppendAllText($marker, "quota`n")
    if ($request.params.supportsLunaReserve -ne $false -or $request.params.excludeResetCreditDetails -ne $true) {
      [Console]::Out.WriteLine('{"id":3,"error":{"code":-32600,"message":"non-minimal request"}}')
      [Console]::Out.Flush()
      continue
    }
    if ($mode -eq 'auth') {
      [Console]::Out.WriteLine('{"id":3,"error":{"code":-32600,"message":"chatgpt authentication required to read rate limits PRIVATE_MARKER"}}')
      [Console]::Out.Flush()
      continue
    }
    if ($mode -eq 'rate-limited') {
      [Console]::Out.WriteLine('{"id":3,"error":{"code":-32603,"message":"PRIVATE_MARKER","data":{"httpStatusCode":429}}}')
      [Console]::Out.Flush()
      continue
    }
    if ($mode -eq 'permission-denied') {
      [Console]::Out.WriteLine('{"id":3,"error":{"code":-32603,"message":"PRIVATE_MARKER","data":{"httpStatusCode":403}}}')
      [Console]::Out.Flush()
      continue
    }
    [Console]::Out.WriteLine('{"id":3,"result":{"accountId":"PRIVATE_MARKER","planType":"PRIVATE_MARKER","rateLimits":{"limitId":"codex","primary":{"usedPercent":42,"windowDurationMins":300,"resetsAt":1800000000,"credits":{"balance":123}},"secondary":null,"resetCreditDetails":{"secret":"PRIVATE_MARKER"}},"rateLimitsByLimitId":{"codex":{"primary":{"usedPercent":42,"windowDurationMins":300,"resetsAt":1800000000,"credits":{"balance":123}},"secondary":null},"other":{"primary":{"usedPercent":12,"windowDurationMins":60,"resetsAt":1800003600},"secondary":null}}}}')
    [Console]::Out.Flush()
    continue
  }
}
"#;

    fn powershell_path() -> PathBuf {
        let windows = std::env::var_os("WINDIR").unwrap_or_else(|| "C:\\Windows".into());
        PathBuf::from(windows)
            .join("System32")
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe")
    }

    fn client(directory: &TestDirectory, mode: &str, timeout: Duration) -> CodexAppServerClient {
        client_with_limits(directory, mode, timeout, 2 * 1024, 16 * 1024)
    }

    fn client_with_limits(
        directory: &TestDirectory,
        mode: &str,
        timeout: Duration,
        max_line_bytes: usize,
        max_total_output_bytes: usize,
    ) -> CodexAppServerClient {
        fs::create_dir_all(directory.codex_home()).expect("create isolated synthetic CODEX_HOME");
        fs::write(directory.script(), FAKE_SERVER).expect("write synthetic app-server script");
        CodexAppServerClient::new(CodexAppServerConfig::for_test(
            powershell_path(),
            directory.codex_home(),
            timeout,
            vec![
                "-NoLogo".into(),
                "-NoProfile".into(),
                "-NonInteractive".into(),
                "-File".into(),
                directory.script().as_os_str().to_owned(),
                mode.into(),
                directory.marker().as_os_str().to_owned(),
                directory.codex_home().as_os_str().to_owned(),
            ],
            max_line_bytes,
            max_total_output_bytes,
        ))
    }

    fn quota_read_count(path: &Path) -> usize {
        fs::read_to_string(path)
            .unwrap_or_default()
            .lines()
            .filter(|line| *line == "quota")
            .count()
    }

    #[test]
    fn protocol_reads_gateway_before_quota_and_returns_only_allowlisted_fields() {
        let directory = TestDirectory::new();
        let client = client(&directory, "success", Duration::from_secs(3));
        let cancellation = AtomicBool::new(false);

        let response = client
            .read_quota(&cancellation)
            .expect("synthetic quota read");

        assert_eq!(response["rateLimits"]["limitId"], "codex");
        assert_eq!(response["rateLimits"]["primary"]["usedPercent"], 42);
        assert_eq!(
            response["rateLimitsByLimitId"]["other"]["primary"]["usedPercent"],
            12
        );
        assert!(response.get("observedAtMs").is_some());
        let serialized = response.to_string();
        assert!(!serialized.contains("PRIVATE_MARKER"));
        assert!(!serialized.contains("credits"));
        assert!(!serialized.contains("resetCreditDetails"));
        assert_eq!(quota_read_count(&directory.marker()), 1);
    }

    #[test]
    fn authentication_rpc_error_is_classified_without_echoing_server_text() {
        let directory = TestDirectory::new();
        let client = client(&directory, "auth", Duration::from_secs(3));
        let cancellation = AtomicBool::new(false);

        let error = client
            .read_quota(&cancellation)
            .expect_err("auth error expected");

        assert_eq!(error.code, "authRequired");
        assert!(!error.message.contains("PRIVATE_MARKER"));
        assert_eq!(quota_read_count(&directory.marker()), 1);
    }

    #[test]
    fn rate_limit_is_not_retried_or_bypassed() {
        let directory = TestDirectory::new();
        let client = client(&directory, "rate-limited", Duration::from_secs(3));
        let cancellation = AtomicBool::new(false);

        let error = client
            .read_quota(&cancellation)
            .expect_err("rate limit expected");

        assert_eq!(error.code, "rateLimited");
        assert!(!error.message.contains("PRIVATE_MARKER"));
        assert_eq!(quota_read_count(&directory.marker()), 1);
    }

    #[test]
    fn permission_error_is_surfaced_without_private_server_text() {
        let directory = TestDirectory::new();
        let client = client(&directory, "permission-denied", Duration::from_secs(3));
        let cancellation = AtomicBool::new(false);

        let error = client
            .read_quota(&cancellation)
            .expect_err("permission error expected");

        assert_eq!(error.code, "permissionDenied");
        assert!(!error.message.contains("PRIVATE_MARKER"));
        assert_eq!(quota_read_count(&directory.marker()), 1);
    }

    #[test]
    fn gateway_not_ready_stops_before_quota_read_and_never_logs_in() {
        let directory = TestDirectory::new();
        let client = client(&directory, "gateway-not-ready", Duration::from_secs(3));
        let cancellation = AtomicBool::new(false);

        let error = client
            .read_quota(&cancellation)
            .expect_err("gateway status must block quota read");

        assert_eq!(error.code, "gatewayAuthNotReady");
        assert_eq!(quota_read_count(&directory.marker()), 0);
    }

    #[test]
    fn unexpected_server_request_stops_without_invoking_login() {
        let directory = TestDirectory::new();
        let client = client(&directory, "server-request", Duration::from_secs(3));
        let cancellation = AtomicBool::new(false);

        let error = client
            .read_quota(&cancellation)
            .expect_err("server request must stop");

        assert_eq!(error.code, "transportError");
        assert_eq!(quota_read_count(&directory.marker()), 0);
    }

    #[test]
    fn timeout_kills_and_reaps_the_synthetic_server() {
        let directory = TestDirectory::new();
        let client = client(&directory, "timeout", Duration::from_secs(3));
        let cancellation = AtomicBool::new(false);
        let started = Instant::now();

        let error = client
            .read_quota(&cancellation)
            .expect_err("timeout expected");

        assert_eq!(error.code, "timeout");
        assert!(started.elapsed() < Duration::from_secs(5));
        assert!(directory.marker().exists());
    }

    #[test]
    fn output_limit_kills_the_synthetic_server() {
        let directory = TestDirectory::new();
        let client = client(&directory, "output-limit", Duration::from_secs(3));
        let cancellation = AtomicBool::new(false);

        let error = client
            .read_quota(&cancellation)
            .expect_err("output limit expected");

        assert_eq!(error.code, "outputLimit");
        assert_eq!(quota_read_count(&directory.marker()), 0);
    }

    #[test]
    fn total_output_limit_kills_the_synthetic_server() {
        let directory = TestDirectory::new();
        let client = client_with_limits(
            &directory,
            "output-total-limit",
            Duration::from_secs(3),
            2 * 1024,
            1024,
        );
        let cancellation = AtomicBool::new(false);

        let error = client
            .read_quota(&cancellation)
            .expect_err("total output limit expected");

        assert_eq!(error.code, "outputLimit");
        assert_eq!(quota_read_count(&directory.marker()), 0);
    }

    #[test]
    fn cancellation_kills_and_reaps_the_synthetic_server() {
        let directory = TestDirectory::new();
        let client = client(&directory, "cancel", Duration::from_secs(10));
        let cancellation = Arc::new(AtomicBool::new(false));
        let worker_cancel = cancellation.clone();
        let worker = thread::spawn(move || client.read_quota(&worker_cancel));
        let started = Instant::now();
        while !directory.marker().exists() && started.elapsed() < Duration::from_secs(3) {
            thread::sleep(Duration::from_millis(10));
        }
        assert!(
            directory.marker().exists(),
            "synthetic server did not become ready"
        );

        cancellation.store(true, Ordering::SeqCst);
        let error = worker
            .join()
            .expect("transport worker must not panic")
            .expect_err("cancellation expected");

        assert_eq!(error.code, "cancelled");
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn process_guard_kills_and_waits_for_its_owned_child() {
        let mut command = Command::new(powershell_path());
        command
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 30",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let child = command.spawn().expect("spawn synthetic owned child");
        let mut guard = ProcessGuard::new(child);

        guard
            .stop_and_wait(Duration::ZERO)
            .expect("kill and reap child");

        assert!(guard.is_reaped());
    }

    #[test]
    #[ignore = "requires explicit authorization for one live Codex quota read"]
    fn authorized_live_quota_read_returns_only_sanitized_schema() {
        let config = CodexAppServerConfig::from_environment()
            .unwrap_or_else(|_| panic!("explicit Codex CLI path and valid CODEX_HOME required"));
        let cancellation = AtomicBool::new(false);
        let response = CodexAppServerClient::new(config)
            .read_quota(&cancellation)
            .unwrap_or_else(|_| panic!("live Codex quota read failed"));

        assert!(response.get("observedAtMs").is_some());
        assert!(
            response.get("rateLimits").is_some() || response.get("rateLimitsByLimitId").is_some()
        );
    }
}
