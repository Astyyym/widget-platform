use super::model::CodexQuotaError;
use serde_json::{json, Map, Value};
use std::env;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdout, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_LINE_BYTES: usize = 64 * 1024;
const MAX_TOTAL_OUTPUT_BYTES: usize = 256 * 1024;
const MAX_MESSAGES: usize = 512;
const POLL_INTERVAL: Duration = Duration::from_millis(25);
const GRACEFUL_EXIT_WAIT: Duration = Duration::from_millis(250);
const MAX_SAFE_JS_INTEGER: i128 = 9_007_199_254_740_991;

pub(super) struct CodexAppServerConfig {
    executable: PathBuf,
    codex_home: PathBuf,
    timeout: Duration,
    max_line_bytes: usize,
    max_total_output_bytes: usize,
    #[cfg(test)]
    command_args: Option<Vec<std::ffi::OsString>>,
}

impl CodexAppServerConfig {
    pub(super) fn from_environment() -> Result<Self, CodexQuotaError> {
        let paths = env::var_os("PATH")
            .map(|value| env::split_paths(&value).collect::<Vec<_>>())
            .unwrap_or_default();
        let executable = resolve_codex_executable(
            env::var_os("WIDGET_CODEX_CLI_PATH").map(PathBuf::from),
            env::var_os("LOCALAPPDATA").map(PathBuf::from),
            &paths,
        )?;

        let codex_home = env::var_os("CODEX_HOME")
            .map(PathBuf::from)
            .or_else(default_codex_home)
            .ok_or_else(|| CodexQuotaError::failure("notConnected"))?;
        if !codex_home.is_absolute() || !codex_home.is_dir() {
            return Err(CodexQuotaError::failure("configurationError"));
        }

        Ok(Self {
            executable,
            codex_home,
            timeout: DEFAULT_TIMEOUT,
            max_line_bytes: MAX_LINE_BYTES,
            max_total_output_bytes: MAX_TOTAL_OUTPUT_BYTES,
            #[cfg(test)]
            command_args: None,
        })
    }

    #[cfg(test)]
    pub(super) fn for_test(
        executable: PathBuf,
        codex_home: PathBuf,
        timeout: Duration,
        command_args: Vec<std::ffi::OsString>,
        max_line_bytes: usize,
        max_total_output_bytes: usize,
    ) -> Self {
        Self {
            executable,
            codex_home,
            timeout,
            max_line_bytes,
            max_total_output_bytes,
            command_args: Some(command_args),
        }
    }
}

fn valid_codex_executable(path: &std::path::Path) -> bool {
    path.is_absolute()
        && path.is_file()
        && path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case("codex.exe"))
}

pub(super) fn resolve_codex_executable(
    explicit: Option<PathBuf>,
    local_app_data: Option<PathBuf>,
    path_entries: &[PathBuf],
) -> Result<PathBuf, CodexQuotaError> {
    // An explicit override remains authoritative; never silently repair it.
    if let Some(path) = explicit {
        return if valid_codex_executable(&path) {
            Ok(path)
        } else {
            Err(CodexQuotaError::failure("configurationError"))
        };
    }
    // Codex Desktop uses versioned bins; inspect only this known installation
    // directory, never the home/auth tree, and never execute a shell shim.
    if let Some(local) = local_app_data.filter(|path| path.is_absolute()) {
        let bin = local.join("OpenAI").join("Codex").join("bin");
        let mut candidates = std::fs::read_dir(&bin)
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .take(64)
            .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
            .map(|entry| entry.path().join("codex.exe"))
            .filter(|path| valid_codex_executable(path))
            .collect::<Vec<_>>();
        candidates.sort_by_key(|path| {
            (
                std::fs::metadata(path).and_then(|m| m.modified()).ok(),
                path.clone(),
            )
        });
        if let Some(path) = candidates.pop() {
            return Ok(path);
        }
    }
    for directory in path_entries
        .iter()
        .filter(|path| path.is_absolute())
        .take(128)
    {
        let path = directory.join("codex.exe");
        if valid_codex_executable(&path) {
            return Ok(path);
        }
    }
    Err(CodexQuotaError::failure("notConnected"))
}

fn default_codex_home() -> Option<PathBuf> {
    #[cfg(windows)]
    let home = env::var_os("USERPROFILE").map(PathBuf::from);
    #[cfg(not(windows))]
    let home = env::var_os("HOME").map(PathBuf::from);
    home.map(|path| path.join(".codex"))
}

pub(super) struct CodexAppServerClient {
    config: CodexAppServerConfig,
}

impl CodexAppServerClient {
    pub(super) fn new(config: CodexAppServerConfig) -> Self {
        Self { config }
    }

    pub(super) fn read_quota(&self, cancellation: &AtomicBool) -> Result<Value, CodexQuotaError> {
        let mut process = ProcessGuard::spawn(&self.config)?;
        let stdout = process
            .child
            .stdout
            .take()
            .ok_or_else(|| CodexQuotaError::failure("transportError"))?;
        let (sender, receiver) = mpsc::channel();
        let max_line_bytes = self.config.max_line_bytes.min(MAX_LINE_BYTES);
        let max_total_output_bytes = self
            .config
            .max_total_output_bytes
            .min(MAX_TOTAL_OUTPUT_BYTES);
        let reader = thread::Builder::new()
            .name("codex-app-server-stdout".to_owned())
            .spawn(move || read_messages(stdout, sender, max_line_bytes, max_total_output_bytes))
            .map_err(|_| CodexQuotaError::failure("transportError"))?;

        let deadline = Instant::now() + self.config.timeout;
        let protocol_result = self.read_protocol(&mut process, &receiver, deadline, cancellation);
        let cleanup_result = process.stop_and_wait(if protocol_result.is_ok() {
            GRACEFUL_EXIT_WAIT
        } else {
            Duration::ZERO
        });
        let reader_result = reader.join();

        if cleanup_result.is_err() {
            return Err(CodexQuotaError::failure("cleanupFailed"));
        }
        if reader_result.is_err() {
            return Err(CodexQuotaError::failure("transportError"));
        }
        protocol_result
    }

    fn read_protocol(
        &self,
        process: &mut ProcessGuard,
        messages: &Receiver<ReaderEvent>,
        deadline: Instant,
        cancellation: &AtomicBool,
    ) -> Result<Value, CodexQuotaError> {
        send_message(
            process,
            &json!({
                "method": "initialize",
                "id": 1,
                "params": {
                    "clientInfo": {
                        "name": "widget-platform",
                        "version": env!("CARGO_PKG_VERSION"),
                    },
                    "capabilities": {
                        "explicitGatewayOauth": true,
                        "optOutNotificationMethods": [
                            "account/gatewayOAuth/changed",
                            "account/rateLimits/updated",
                        ],
                    },
                },
            }),
        )?;
        await_response(process, messages, 1, deadline, cancellation)?;

        check_cancelled(cancellation)?;
        send_message(
            process,
            &json!({
                "method": "initialized",
                "params": {},
            }),
        )?;
        send_message(
            process,
            &json!({
                "method": "account/gatewayOAuth/read",
                "id": 2,
                "params": {},
            }),
        )?;
        let gateway = await_response(process, messages, 2, deadline, cancellation)?;
        validate_gateway_state(&gateway)?;

        check_cancelled(cancellation)?;
        send_message(
            process,
            &json!({
                "method": "account/rateLimits/read",
                "id": 3,
                "params": {
                    "supportsLunaReserve": false,
                    "excludeResetCreditDetails": true,
                },
            }),
        )?;
        let response = await_response(process, messages, 3, deadline, cancellation)?;
        sanitize_quota_response(&response)
    }
}

fn check_cancelled(cancellation: &AtomicBool) -> Result<(), CodexQuotaError> {
    if cancellation.load(Ordering::SeqCst) {
        Err(CodexQuotaError::failure("cancelled"))
    } else {
        Ok(())
    }
}

fn send_message(process: &mut ProcessGuard, message: &Value) -> Result<(), CodexQuotaError> {
    let stdin = process
        .child
        .stdin
        .as_mut()
        .ok_or_else(|| CodexQuotaError::failure("transportError"))?;
    serde_json::to_writer(&mut *stdin, message)
        .map_err(|_| CodexQuotaError::failure("transportError"))?;
    stdin
        .write_all(b"\n")
        .and_then(|_| stdin.flush())
        .map_err(|_| CodexQuotaError::failure("transportError"))
}

fn await_response(
    process: &mut ProcessGuard,
    messages: &Receiver<ReaderEvent>,
    request_id: u64,
    deadline: Instant,
    cancellation: &AtomicBool,
) -> Result<Value, CodexQuotaError> {
    let expected_id = Value::from(request_id);
    loop {
        check_cancelled(cancellation)?;
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(CodexQuotaError::failure("timeout"));
        }
        match messages.recv_timeout(remaining.min(POLL_INTERVAL)) {
            Ok(ReaderEvent::Message(message)) => {
                if let Some(object) = message.as_object() {
                    if object.contains_key("method") {
                        if object.contains_key("id") {
                            return Err(CodexQuotaError::failure("transportError"));
                        }
                        continue;
                    }
                } else {
                    return Err(CodexQuotaError::failure("invalidResponse"));
                }
                if message.get("id") != Some(&expected_id) {
                    continue;
                }
                if let Some(error) = message.get("error") {
                    if !error.is_object() {
                        return Err(CodexQuotaError::failure("invalidResponse"));
                    }
                    return Err(classify_rpc_error(error));
                }
                return message
                    .get("result")
                    .cloned()
                    .ok_or_else(|| CodexQuotaError::failure("invalidResponse"));
            }
            Ok(ReaderEvent::Failure(error)) => return Err(error),
            Ok(ReaderEvent::Eof) => return Err(CodexQuotaError::failure("transportError")),
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(CodexQuotaError::failure("transportError"));
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if process.try_wait().is_some() {
                    return Err(CodexQuotaError::failure("transportError"));
                }
            }
        }
    }
}

fn validate_gateway_state(value: &Value) -> Result<(), CodexQuotaError> {
    let Some(object) = value.as_object() else {
        return Err(CodexQuotaError::failure("invalidResponse"));
    };
    if object.get("error").is_some_and(|error| !error.is_null()) {
        return Err(CodexQuotaError::failure("gatewayAuthNotReady"));
    }
    let Some(required) = object.get("required").and_then(Value::as_bool) else {
        return Err(CodexQuotaError::failure("invalidResponse"));
    };
    let status = object.get("status");
    if status.is_some_and(|status| !status.is_null() && !status.is_string()) {
        return Err(CodexQuotaError::failure("invalidResponse"));
    }
    if required && status.and_then(Value::as_str) != Some("succeeded") {
        return Err(CodexQuotaError::failure("gatewayAuthNotReady"));
    }
    Ok(())
}

fn sanitize_quota_response(value: &Value) -> Result<Value, CodexQuotaError> {
    let Some(object) = value.as_object() else {
        return Err(CodexQuotaError::failure("invalidResponse"));
    };
    let mut sanitized = Map::new();
    if let Some(bucket) = object.get("rateLimits").and_then(Value::as_object) {
        sanitized.insert(
            "rateLimits".to_owned(),
            sanitize_bucket(&Value::Object(bucket.clone()), true)?,
        );
    }
    if let Some(buckets) = object.get("rateLimitsByLimitId").and_then(Value::as_object) {
        let mut sanitized_buckets = Map::new();
        for (id, bucket) in buckets {
            sanitized_buckets.insert(id.clone(), sanitize_bucket(bucket, false)?);
        }
        sanitized.insert(
            "rateLimitsByLimitId".to_owned(),
            Value::Object(sanitized_buckets),
        );
    }
    if sanitized.is_empty() {
        return Err(CodexQuotaError::failure("invalidResponse"));
    }
    let observed_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
        .filter(|timestamp| *timestamp >= 0)
        .ok_or_else(|| CodexQuotaError::failure("transportError"))?;
    sanitized.insert("observedAtMs".to_owned(), Value::from(observed_at_ms));
    Ok(Value::Object(sanitized))
}

fn sanitize_bucket(value: &Value, include_limit_id: bool) -> Result<Value, CodexQuotaError> {
    let Some(object) = value.as_object() else {
        return Err(CodexQuotaError::failure("invalidResponse"));
    };
    let mut bucket = Map::new();
    if include_limit_id {
        if let Some(Value::String(limit_id)) = object.get("limitId") {
            bucket.insert("limitId".to_owned(), Value::String(limit_id.clone()));
        }
    }
    for field in ["primary", "secondary"] {
        if let Some(window) = object.get(field) {
            let sanitized_window = if window.is_null() {
                Value::Null
            } else {
                sanitize_window(window)?
            };
            bucket.insert(field.to_owned(), sanitized_window);
        }
    }
    Ok(Value::Object(bucket))
}

fn sanitize_window(value: &Value) -> Result<Value, CodexQuotaError> {
    let Some(object) = value.as_object() else {
        return Err(CodexQuotaError::failure("invalidResponse"));
    };
    let Some(used_percent) = object.get("usedPercent").and_then(integer_value) else {
        return Err(CodexQuotaError::failure("invalidResponse"));
    };
    if !(0..=i32::MAX as i128).contains(&used_percent) {
        return Err(CodexQuotaError::failure("invalidResponse"));
    }

    let mut window = Map::new();
    window.insert("usedPercent".to_owned(), Value::from(used_percent as i64));
    if let Some(duration) = object.get("windowDurationMins") {
        if !duration.is_null() {
            let Some(duration_value) = integer_value(duration) else {
                return Err(CodexQuotaError::failure("invalidResponse"));
            };
            if !(0..=MAX_SAFE_JS_INTEGER).contains(&duration_value) {
                return Err(CodexQuotaError::failure("invalidResponse"));
            }
        }
        window.insert("windowDurationMins".to_owned(), duration.clone());
    }
    if let Some(reset) = object.get("resetsAt") {
        if !reset.is_null() {
            let Some(reset_value) = integer_value(reset) else {
                return Err(CodexQuotaError::failure("invalidResponse"));
            };
            if reset_value
                .checked_mul(1_000)
                .is_none_or(|milliseconds| milliseconds.abs() > MAX_SAFE_JS_INTEGER)
            {
                return Err(CodexQuotaError::failure("invalidResponse"));
            }
        }
        window.insert("resetsAt".to_owned(), reset.clone());
    }
    Ok(Value::Object(window))
}

fn integer_value(value: &Value) -> Option<i128> {
    value
        .as_i64()
        .map(i128::from)
        .or_else(|| value.as_u64().map(i128::from))
}

fn classify_rpc_error(error: &Value) -> CodexQuotaError {
    if let Some(status) = http_status(error) {
        match status {
            401 => return CodexQuotaError::failure("authRequired"),
            403 => return CodexQuotaError::failure("permissionDenied"),
            429 => return CodexQuotaError::failure("rateLimited"),
            _ => {}
        }
    }
    let error_info = error
        .get("data")
        .and_then(|data| data.get("codexErrorInfo"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    match error_info.as_str() {
        "unauthorized" | "authenticationrequired" => {
            return CodexQuotaError::failure("authRequired");
        }
        "forbidden" => return CodexQuotaError::failure("permissionDenied"),
        "ratelimitexceeded" => return CodexQuotaError::failure("rateLimited"),
        _ => {}
    }
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if message.contains("chatgpt authentication required")
        || message.contains("codex account authentication required")
        || message.contains("401 unauthorized")
        || message.contains("unauthorized")
    {
        return CodexQuotaError::failure("authRequired");
    }
    if message.contains("403 forbidden") || message.contains("permission denied") {
        return CodexQuotaError::failure("permissionDenied");
    }
    if message.contains("429")
        || message.contains("too many requests")
        || message.contains("rate limit exceeded")
    {
        return CodexQuotaError::failure("rateLimited");
    }
    CodexQuotaError::failure("transportError")
}

fn http_status(error: &Value) -> Option<u64> {
    let data = error.get("data")?.as_object()?;
    for key in [
        "httpStatusCode",
        "httpStatus",
        "statusCode",
        "status_code",
        "status",
    ] {
        if let Some(status) = data.get(key).and_then(Value::as_u64) {
            return Some(status);
        }
    }
    let error_info = data.get("codexErrorInfo")?;
    if let Some(info) = error_info.as_object() {
        for value in info.values() {
            if let Some(status) = value
                .as_object()
                .and_then(|object| object.get("httpStatusCode"))
                .and_then(Value::as_u64)
            {
                return Some(status);
            }
        }
    }
    None
}

enum ReaderEvent {
    Message(Value),
    Failure(CodexQuotaError),
    Eof,
}

fn read_messages(
    stdout: ChildStdout,
    sender: Sender<ReaderEvent>,
    max_line_bytes: usize,
    max_total_output_bytes: usize,
) {
    let mut reader = BufReader::new(stdout);
    let mut line = Vec::new();
    let mut total_bytes = 0usize;
    let mut message_count = 0usize;

    loop {
        let (chunk_bytes, complete_line) = {
            let available = match reader.fill_buf() {
                Ok(available) => available,
                Err(_) => {
                    let _ = sender.send(ReaderEvent::Failure(CodexQuotaError::failure(
                        "transportError",
                    )));
                    return;
                }
            };
            if available.is_empty() {
                if !line.is_empty() && !send_line(&mut line, &sender, &mut message_count) {
                    return;
                }
                let _ = sender.send(ReaderEvent::Eof);
                return;
            }
            let newline = available.iter().position(|byte| *byte == b'\n');
            let count = newline.map_or(available.len(), |index| index + 1);
            if line.len().saturating_add(count) > max_line_bytes
                || total_bytes.saturating_add(count) > max_total_output_bytes
            {
                let _ = sender.send(ReaderEvent::Failure(CodexQuotaError::failure(
                    "outputLimit",
                )));
                return;
            }
            line.extend_from_slice(&available[..count]);
            (count, newline.is_some())
        };
        reader.consume(chunk_bytes);
        total_bytes = total_bytes.saturating_add(chunk_bytes);
        if complete_line && !send_line(&mut line, &sender, &mut message_count) {
            return;
        }
    }
}

fn send_line(line: &mut Vec<u8>, sender: &Sender<ReaderEvent>, message_count: &mut usize) -> bool {
    while matches!(line.last(), Some(b'\n' | b'\r')) {
        line.pop();
    }
    if line.is_empty() {
        return true;
    }
    *message_count = message_count.saturating_add(1);
    if *message_count > MAX_MESSAGES {
        let _ = sender.send(ReaderEvent::Failure(CodexQuotaError::failure(
            "outputLimit",
        )));
        return false;
    }
    let message = match serde_json::from_slice::<Value>(line) {
        Ok(message @ Value::Object(_)) => message,
        _ => {
            let _ = sender.send(ReaderEvent::Failure(CodexQuotaError::failure(
                "invalidResponse",
            )));
            return false;
        }
    };
    line.clear();
    sender.send(ReaderEvent::Message(message)).is_ok()
}

pub(super) struct ProcessGuard {
    child: Child,
    reaped: bool,
}

impl ProcessGuard {
    fn spawn(config: &CodexAppServerConfig) -> Result<Self, CodexQuotaError> {
        let mut command = Command::new(&config.executable);
        #[cfg(test)]
        if let Some(arguments) = &config.command_args {
            command.args(arguments);
        } else {
            command.args(["app-server", "--listen", "stdio://"]);
        }
        #[cfg(not(test))]
        command.args(["app-server", "--listen", "stdio://"]);
        command
            .env("CODEX_HOME", &config.codex_home)
            .env_remove("OPENAI_API_KEY")
            .env_remove("CODEX_API_KEY")
            .env_remove("OPENAI_BASE_URL")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        let child = command
            .spawn()
            .map_err(|_| CodexQuotaError::failure("notConnected"))?;
        Ok(Self {
            child,
            reaped: false,
        })
    }

    #[cfg(test)]
    pub(super) fn new(child: Child) -> Self {
        Self {
            child,
            reaped: false,
        }
    }

    fn try_wait(&mut self) -> Option<ExitStatus> {
        match self.child.try_wait() {
            Ok(status) => {
                if status.is_some() {
                    self.reaped = true;
                }
                status
            }
            Err(_) => None,
        }
    }

    pub(super) fn stop_and_wait(&mut self, grace_period: Duration) -> Result<(), ()> {
        self.child.stdin.take();
        if self.reaped {
            return Ok(());
        }
        let deadline = Instant::now() + grace_period;
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => {
                    self.reaped = true;
                    return Ok(());
                }
                Ok(None) if Instant::now() < deadline => {
                    thread::sleep(
                        POLL_INTERVAL.min(deadline.saturating_duration_since(Instant::now())),
                    );
                }
                Ok(None) | Err(_) => break,
            }
        }
        let _ = self.child.kill();
        match self.child.wait() {
            Ok(_) => {
                self.reaped = true;
                Ok(())
            }
            Err(_) => Err(()),
        }
    }

    #[cfg(test)]
    pub(super) fn is_reaped(&self) -> bool {
        self.reaped
    }
}

impl Drop for ProcessGuard {
    fn drop(&mut self) {
        if !self.reaped {
            let _ = self.child.kill();
            if self.child.wait().is_ok() {
                self.reaped = true;
            }
        }
    }
}
