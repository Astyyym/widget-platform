export type CodexQuotaWindow = {
  usedPercent: number;
  windowDurationMinutes: number | null;
  resetsAtMs: number | null;
};

export type CodexQuotaBucket = {
  id: string;
  primary: CodexQuotaWindow | null;
  secondary: CodexQuotaWindow | null;
};

export type CodexQuotaSnapshot = {
  source: "codex-app-server";
  observedAtMs: number;
  coreBucket: CodexQuotaBucket | null;
  otherBuckets: CodexQuotaBucket[];
};

export type CodexQuotaFailureReason =
  | "notConnected"
  | "configurationError"
  | "authRequired"
  | "gatewayAuthNotReady"
  | "permissionDenied"
  | "rateLimited"
  | "timeout"
  | "invalidResponse"
  | "outputLimit"
  | "refreshNotDue"
  | "cleanupFailed"
  | "transportError";

export type CodexQuotaCommandError = {
  code: string;
  retryAfterMs: number | null;
};

export type CodexQuotaState =
  | {
      quality: "fresh";
      snapshot: CodexQuotaSnapshot;
      failureReason: null;
      lastAttemptAtMs: number;
    }
  | {
      quality: "stale";
      snapshot: CodexQuotaSnapshot;
      failureReason: CodexQuotaFailureReason;
      lastAttemptAtMs: number;
    }
  | {
      quality: "unavailable";
      snapshot: null;
      failureReason: CodexQuotaFailureReason;
      lastAttemptAtMs: number | null;
    };

export type FreshCodexQuotaState = Extract<CodexQuotaState, { quality: "fresh" }>;

const FAILURE_LABELS: Record<CodexQuotaFailureReason, string> = {
  notConnected: "尚未连接官方额度读取",
  configurationError: "Codex 官方读取配置不可用；未启动子进程",
  authRequired: "需要在 Codex 官方客户端登录",
  gatewayAuthNotReady: "Codex Gateway OAuth 状态未就绪；未发起登录",
  permissionDenied: "官方接口拒绝了额度读取",
  rateLimited: "官方服务限流；稍后重试",
  timeout: "官方读取超时",
  invalidResponse: "官方响应格式无效",
  outputLimit: "官方响应超过安全大小限制",
  refreshNotDue: "额度读取处于刷新间隔或失败退避期",
  cleanupFailed: "Codex app-server 未能正常退出；读取已终止",
  transportError: "官方读取不可用",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseWindow(value: unknown, bucketId: string, field: string): CodexQuotaWindow | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) {
    throw new Error(`Codex额度响应中的 ${bucketId}.${field} 格式无效。`);
  }

  const usedPercent = value.usedPercent;
  if (
    typeof usedPercent !== "number" ||
    !Number.isInteger(usedPercent) ||
    usedPercent < 0 ||
    usedPercent > 2_147_483_647
  ) {
    throw new Error(`Codex额度响应中的 ${bucketId}.${field}.usedPercent 无效。`);
  }

  const rawDuration = value.windowDurationMins;
  let windowDurationMinutes: number | null = null;
  if (rawDuration !== null && rawDuration !== undefined) {
    if (!Number.isSafeInteger(rawDuration) || (rawDuration as number) < 0) {
      throw new Error(`Codex额度响应中的 ${bucketId}.${field}.windowDurationMins 无效。`);
    }
    windowDurationMinutes = rawDuration as number;
  }

  const rawReset = value.resetsAt;
  let resetsAtMs: number | null = null;
  if (rawReset !== null && rawReset !== undefined) {
    if (
      !Number.isSafeInteger(rawReset) ||
      Math.abs((rawReset as number) * 1000) > Number.MAX_SAFE_INTEGER
    ) {
      throw new Error(`Codex额度响应中的 ${bucketId}.${field}.resetsAt 无效。`);
    }
    resetsAtMs = (rawReset as number) * 1000;
  }

  return { usedPercent, windowDurationMinutes, resetsAtMs };
}

function parseBucket(id: string, value: unknown): CodexQuotaBucket {
  if (!isRecord(value)) {
    throw new Error(`Codex额度响应中的bucket ${id} 格式无效。`);
  }
  return {
    id,
    primary: parseWindow(value.primary, id, "primary"),
    secondary: parseWindow(value.secondary, id, "secondary"),
  };
}

export function parseCodexRateLimitsResponse(
  value: unknown,
  observedAtMs: number,
): CodexQuotaSnapshot {
  if (!Number.isSafeInteger(observedAtMs) || observedAtMs < 0) {
    throw new Error("Codex额度读取时间无效。");
  }
  if (!isRecord(value)) {
    throw new Error("Codex额度响应格式无效。");
  }

  const bucketMap = value.rateLimitsByLimitId;
  let coreBucket: CodexQuotaBucket | null = null;
  let otherBuckets: CodexQuotaBucket[] = [];
  if (isRecord(bucketMap)) {
    const coreValue = bucketMap.codex;
    coreBucket = coreValue === undefined ? null : parseBucket("codex", coreValue);
    otherBuckets = Object.entries(bucketMap)
      .filter(([id]) => id !== "codex")
      .map(([id, bucket]) => parseBucket(id, bucket));
  } else if (isRecord(value.rateLimits)) {
    const rawId = value.rateLimits.limitId;
    const id = typeof rawId === "string" && rawId.length > 0 ? rawId : "codex";
    const bucket = parseBucket(id, value.rateLimits);
    if (id === "codex") coreBucket = bucket;
    else otherBuckets = [bucket];
  } else {
    throw new Error("Codex额度响应缺少rateLimits数据。");
  }

  return {
    source: "codex-app-server",
    observedAtMs,
    coreBucket,
    otherBuckets,
  };
}

export function parseCodexQuotaCommandResponse(
  value: unknown,
): CodexQuotaSnapshot {
  if (!isRecord(value)) {
    throw new Error("Codex额度命令响应格式无效。");
  }
  const observedAtMs = value.observedAtMs;
  if (
    typeof observedAtMs !== "number" ||
    !Number.isSafeInteger(observedAtMs) ||
    observedAtMs < 0
  ) {
    throw new Error("Codex额度命令响应缺少有效观察时间。");
  }
  return parseCodexRateLimitsResponse(value, observedAtMs);
}

export function parseCodexQuotaCommandError(
  error: unknown,
): CodexQuotaCommandError {
  if (!isRecord(error)) {
    return { code: "transportError", retryAfterMs: null };
  }
  const code = typeof error.code === "string" ? error.code : "transportError";
  const retryAfterMs =
    typeof error.retryAfterMs === "number" &&
    Number.isSafeInteger(error.retryAfterMs) &&
    error.retryAfterMs >= 0
      ? error.retryAfterMs
      : null;
  return { code, retryAfterMs };
}

export function classifyCodexQuotaCommandError(
  error: unknown,
): CodexQuotaFailureReason | null {
  const { code } = parseCodexQuotaCommandError(error);
  switch (code) {
    case "notConnected":
    case "configurationError":
    case "authRequired":
    case "gatewayAuthNotReady":
    case "permissionDenied":
    case "rateLimited":
    case "timeout":
    case "invalidResponse":
    case "outputLimit":
    case "refreshNotDue":
    case "cleanupFailed":
    case "transportError":
      return code;
    case "cancelled":
    case "refreshInProgress":
      return null;
    default:
      return "transportError";
  }
}

export function createCodexQuotaFreshState(
  snapshot: CodexQuotaSnapshot,
): CodexQuotaState {
  return {
    quality: "fresh",
    snapshot,
    failureReason: null,
    lastAttemptAtMs: snapshot.observedAtMs,
  };
}

export function applyCodexQuotaFailure(
  previous: CodexQuotaState | null,
  failureReason: CodexQuotaFailureReason,
  lastAttemptAtMs: number,
): CodexQuotaState {
  if (previous && previous.snapshot) {
    return {
      quality: "stale",
      snapshot: previous.snapshot,
      failureReason,
      lastAttemptAtMs,
    };
  }
  return {
    quality: "unavailable",
    snapshot: null,
    failureReason,
    lastAttemptAtMs,
  };
}

export function classifyCodexQuotaFailure(input: {
  status?: number;
  timedOut?: boolean;
  invalidResponse?: boolean;
}): CodexQuotaFailureReason {
  if (input.invalidResponse) return "invalidResponse";
  if (input.timedOut) return "timeout";
  if (input.status === 401) return "authRequired";
  if (input.status === 403) return "permissionDenied";
  if (input.status === 429) return "rateLimited";
  return "transportError";
}

export function describeCodexQuotaFailure(
  reason: CodexQuotaFailureReason,
): string {
  return FAILURE_LABELS[reason];
}

export function getCodexQuotaProgress(
  state: CodexQuotaState,
): number | undefined {
  return state.snapshot?.coreBucket?.primary?.usedPercent;
}

export function formatCodexQuotaSummary(state: CodexQuotaState): string {
  if (state.quality === "unavailable") {
    return FAILURE_LABELS[state.failureReason];
  }
  const primary = state.snapshot.coreBucket?.primary;
  const summary = primary
    ? `主窗口已用 ${primary.usedPercent}%`
    : "主窗口额度未提供";
  return state.quality === "stale" ? `数据过期 · ${summary}` : summary;
}
