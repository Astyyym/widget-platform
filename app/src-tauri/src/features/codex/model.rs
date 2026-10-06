use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexQuotaError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<u64>,
}

impl CodexQuotaError {
    pub(super) fn failure(code: &str) -> Self {
        let (message, retryable) = match code {
            "notConnected" => ("尚未配置官方 Codex 可执行文件或 CODEX_HOME。", false),
            "configurationError" => ("官方 Codex 本地配置不可用；未启动子进程。", false),
            "authRequired" => ("需要在官方 Codex 客户端完成登录。", false),
            "permissionDenied" => ("官方接口拒绝了额度读取。", false),
            "rateLimited" => ("官方服务限流；已进入退避，不会立即重试。", true),
            "timeout" => ("官方额度读取超时。", true),
            "cancelled" => ("官方额度读取已取消。", true),
            "invalidResponse" => ("官方额度响应格式无效。", false),
            "outputLimit" => ("官方额度响应超过安全大小限制。", false),
            "gatewayAuthNotReady" => ("Codex Gateway OAuth 状态未就绪；未发起登录。", false),
            "refreshInProgress" => ("Codex 额度读取正在进行。", true),
            "refreshNotDue" => ("Codex 额度读取处于刷新间隔或失败退避期。", true),
            "cleanupFailed" => ("Codex app-server 未能正常退出；读取已终止。", true),
            _ => ("官方 Codex 额度读取暂时不可用。", true),
        };
        Self {
            code: code.to_owned(),
            message: message.to_owned(),
            retryable,
            retry_after_ms: None,
        }
    }

    pub(super) fn retry_after(code: &str, delay_ms: u64) -> Self {
        let mut error = Self::failure(code);
        error.retry_after_ms = Some(delay_ms);
        error
    }
}
