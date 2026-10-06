use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CpuStatus {
    WarmingUp,
    Available,
    ProcessorGroupLimit,
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MemoryStatus {
    Available,
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryReading {
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub used_bytes: u64,
    pub used_percent: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuMemoryReading {
    pub budget_bytes: u64,
    pub process_usage_bytes: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GpuEngineStatus {
    Available,
    Unsupported,
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuReading {
    pub luid: String,
    pub name: String,
    pub vendor_id: u32,
    pub device_id: u32,
    pub dedicated: Option<GpuMemoryReading>,
    pub shared: Option<GpuMemoryReading>,
    pub adapter_wide_dedicated_bytes: Option<u64>,
    pub adapter_wide_shared_bytes: Option<u64>,
    pub engine_utilization_percent: Option<f64>,
    pub engine_status: GpuEngineStatus,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsSnapshot {
    pub schema_version: u16,
    pub revision: u64,
    pub observed_at_ms: i64,
    pub cpu_status: CpuStatus,
    pub cpu_usage_percent: Option<f64>,
    pub logical_processor_count: Option<u32>,
    pub memory_status: MemoryStatus,
    pub memory: Option<MemoryReading>,
    pub gpus: Vec<GpuReading>,
}

impl MetricsSnapshot {
    pub fn unavailable(revision: u64, observed_at_ms: i64) -> Self {
        Self {
            schema_version: 1,
            revision,
            observed_at_ms,
            cpu_status: CpuStatus::Unavailable,
            cpu_usage_percent: None,
            logical_processor_count: None,
            memory_status: MemoryStatus::Unavailable,
            memory: None,
            gpus: Vec::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct CpuTimes {
    pub idle: u64,
    pub kernel: u64,
    pub user: u64,
}

pub(crate) fn gpu_memory_reading(
    budget_bytes: u64,
    process_usage_bytes: u64,
) -> Option<GpuMemoryReading> {
    (budget_bytes > 0 || process_usage_bytes > 0).then_some(GpuMemoryReading {
        budget_bytes,
        process_usage_bytes,
    })
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct PdhGpuMemorySample {
    pub luid: String,
    pub dedicated_bytes: Option<u64>,
    pub shared_bytes: Option<u64>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct PdhGpuEngineSample {
    pub luid: String,
    pub utilization_percent: f64,
}

pub(crate) fn normalize_luid_instance(value: &str) -> Option<String> {
    let start = value.find("luid_")?;
    let mut parts = value[start..].split('_');
    parts.next()?;
    let high = parts.next()?.strip_prefix("0x")?;
    let low = parts.next()?.strip_prefix("0x")?;
    if high.len() != 8
        || low.len() != 8
        || !high.chars().all(|c| c.is_ascii_hexdigit())
        || !low.chars().all(|c| c.is_ascii_hexdigit())
    {
        return None;
    }
    Some(format!(
        "{}:{}",
        high.to_ascii_uppercase(),
        low.to_ascii_uppercase()
    ))
}

pub(crate) fn aggregate_pdh_gpu_memory(
    samples: &[PdhGpuMemorySample],
    luid: &str,
) -> Option<(u64, u64)> {
    let mut dedicated = None;
    let mut shared = None;
    for sample in samples.iter().filter(|sample| sample.luid == luid) {
        if let Some(value) = sample.dedicated_bytes {
            dedicated = Some(dedicated.unwrap_or(0u64).saturating_add(value));
        }
        if let Some(value) = sample.shared_bytes {
            shared = Some(shared.unwrap_or(0u64).saturating_add(value));
        }
    }
    (dedicated.or(shared)).map(|_| (dedicated.unwrap_or(0), shared.unwrap_or(0)))
}

pub(crate) fn aggregate_pdh_gpu_engine(samples: &[PdhGpuEngineSample], luid: &str) -> Option<f64> {
    let mut total = 0.0;
    let mut found = false;
    for sample in samples.iter().filter(|sample| sample.luid == luid) {
        if sample.utilization_percent.is_finite() && sample.utilization_percent >= 0.0 {
            total += sample.utilization_percent;
            found = true;
        }
    }
    found.then_some(total.clamp(0.0, 100.0))
}

pub(crate) fn cpu_delta_percent(previous: Option<CpuTimes>, current: CpuTimes) -> Option<f64> {
    let previous = previous?;
    let idle_delta = current.idle.checked_sub(previous.idle)?;
    let kernel_delta = current.kernel.checked_sub(previous.kernel)?;
    let user_delta = current.user.checked_sub(previous.user)?;
    let total_delta = kernel_delta.checked_add(user_delta)?;
    if total_delta == 0 || idle_delta > total_delta {
        return None;
    }

    let busy_delta = total_delta - idle_delta;
    let percent = busy_delta as f64 * 100.0 / total_delta as f64;
    percent.is_finite().then_some(percent.clamp(0.0, 100.0))
}

pub(crate) fn memory_reading(total_bytes: u64, available_bytes: u64) -> Option<MemoryReading> {
    if total_bytes == 0 || available_bytes > total_bytes {
        return None;
    }

    let used_bytes = total_bytes - available_bytes;
    Some(MemoryReading {
        total_bytes,
        available_bytes,
        used_bytes,
        used_percent: used_bytes as f64 * 100.0 / total_bytes as f64,
    })
}

pub(crate) fn cpu_status_for_sample(
    logical_processor_count: Option<u32>,
    has_times: bool,
    usage_percent: Option<f64>,
) -> CpuStatus {
    match logical_processor_count {
        Some(count) if count > 64 => CpuStatus::ProcessorGroupLimit,
        None | Some(0) => CpuStatus::Unavailable,
        Some(_) if !has_times => CpuStatus::Unavailable,
        Some(_) if usage_percent.is_some() => CpuStatus::Available,
        Some(_) => CpuStatus::WarmingUp,
    }
}
