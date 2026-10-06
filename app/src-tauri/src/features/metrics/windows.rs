use std::mem::MaybeUninit;
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use super::model::{
    cpu_delta_percent, cpu_status_for_sample, gpu_memory_reading, memory_reading, CpuTimes,
    GpuEngineStatus, GpuMemoryReading, GpuReading, MemoryReading, MemoryStatus, MetricsSnapshot,
    PdhGpuEngineSample, PdhGpuMemorySample,
};
use windows::core::{Interface, PCWSTR};
use windows::Win32::Foundation::{FILETIME, LUID};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIAdapter3, IDXGIAdapter4, IDXGIFactory1, DXGI_ADAPTER_FLAG3_REMOTE,
    DXGI_ADAPTER_FLAG3_SOFTWARE, DXGI_MEMORY_SEGMENT_GROUP_LOCAL,
    DXGI_MEMORY_SEGMENT_GROUP_NON_LOCAL, DXGI_QUERY_VIDEO_MEMORY_INFO,
};
use windows::Win32::System::Performance::{
    PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterArrayW,
    PdhOpenQueryW, PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE, PDH_FMT_LARGE, PDH_HCOUNTER,
    PDH_HQUERY, PDH_MORE_DATA,
};
use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows::Win32::System::Threading::{
    GetActiveProcessorCount, GetSystemTimes, ALL_PROCESSOR_GROUPS,
};
#[derive(Default)]
struct SamplerState {
    revision: u64,
    session_id: Option<String>,
    previous_cpu: Option<CpuTimes>,
}

pub struct MetricsState {
    sampler: Mutex<SamplerState>,
}

impl MetricsState {
    pub fn new() -> Self {
        Self {
            sampler: Mutex::new(SamplerState::default()),
        }
    }

    pub fn sample(&self, session_id: &str) -> MetricsSnapshot {
        let mut state = self.lock_sampler();
        state.revision = state.revision.saturating_add(1);
        let revision = state.revision;
        let observed_at_ms = unix_time_ms();

        if !valid_session_id(session_id) {
            state.session_id = None;
            state.previous_cpu = None;
            return MetricsSnapshot::unavailable(revision, observed_at_ms);
        }

        if state.session_id.as_deref() != Some(session_id) {
            state.session_id = Some(session_id.to_string());
            state.previous_cpu = None;
        }

        let logical_processor_count = active_processor_count();
        let mut usage_percent = None;
        let mut cpu_times = None;

        match logical_processor_count {
            Some(count) if count <= 64 => {
                if let Some(current) = system_cpu_times() {
                    usage_percent = cpu_delta_percent(state.previous_cpu, current);
                    cpu_times = Some(current);
                }
            }
            Some(_) | None => {}
        }

        let cpu_status =
            cpu_status_for_sample(logical_processor_count, cpu_times.is_some(), usage_percent);
        state.previous_cpu = cpu_times;

        let memory = physical_memory();
        let gpus = gpu_readings();
        MetricsSnapshot {
            schema_version: 1,
            revision,
            observed_at_ms,
            cpu_status,
            cpu_usage_percent: usage_percent,
            logical_processor_count,
            memory_status: if memory.is_some() {
                MemoryStatus::Available
            } else {
                MemoryStatus::Unavailable
            },
            memory,
            gpus,
        }
    }

    fn lock_sampler(&self) -> MutexGuard<'_, SamplerState> {
        self.sampler
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl Default for MetricsState {
    fn default() -> Self {
        Self::new()
    }
}

fn valid_session_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn active_processor_count() -> Option<u32> {
    let count = unsafe { GetActiveProcessorCount(ALL_PROCESSOR_GROUPS) };
    (count > 0).then_some(count)
}

fn system_cpu_times() -> Option<CpuTimes> {
    let mut idle = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    unsafe {
        GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)).ok()?;
    }
    Some(CpuTimes {
        idle: filetime_value(idle),
        kernel: filetime_value(kernel),
        user: filetime_value(user),
    })
}

fn filetime_value(value: FILETIME) -> u64 {
    ((value.dwHighDateTime as u64) << 32) | value.dwLowDateTime as u64
}

fn physical_memory() -> Option<MemoryReading> {
    let mut status = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..MEMORYSTATUSEX::default()
    };
    unsafe { GlobalMemoryStatusEx(&mut status).ok()? };
    memory_reading(status.ullTotalPhys, status.ullAvailPhys)
}

fn gpu_readings() -> Vec<GpuReading> {
    let Ok(factory) = (unsafe { CreateDXGIFactory1::<IDXGIFactory1>() }) else {
        return Vec::new();
    };
    let mut readings = Vec::new();
    for index in 0..32 {
        let Ok(adapter) = (unsafe { factory.EnumAdapters1(index) }) else {
            break;
        };
        let Ok(adapter3) = adapter.cast::<IDXGIAdapter3>() else {
            continue;
        };
        let Ok(adapter4) = adapter.cast::<IDXGIAdapter4>() else {
            continue;
        };
        let Ok(desc3) = (unsafe { adapter4.GetDesc3() }) else {
            continue;
        };
        if desc3.Flags.contains(DXGI_ADAPTER_FLAG3_REMOTE)
            || desc3.Flags.contains(DXGI_ADAPTER_FLAG3_SOFTWARE)
        {
            continue;
        }
        readings.push(GpuReading {
            luid: format_luid(desc3.AdapterLuid),
            name: utf16_string(&desc3.Description),
            vendor_id: desc3.VendorId,
            device_id: desc3.DeviceId,
            dedicated: query_video_memory(&adapter3, DXGI_MEMORY_SEGMENT_GROUP_LOCAL),
            shared: query_video_memory(&adapter3, DXGI_MEMORY_SEGMENT_GROUP_NON_LOCAL),
            adapter_wide_dedicated_bytes: None,
            adapter_wide_shared_bytes: None,
            engine_utilization_percent: None,
            engine_status: GpuEngineStatus::Unavailable,
        });
    }
    apply_pdh_readings(&mut readings);
    readings
}

fn apply_pdh_readings(readings: &mut [GpuReading]) {
    let Some((memory, engine)) = read_pdh_gpu_samples() else {
        return;
    };
    for reading in readings {
        if let Some((dedicated, shared)) =
            super::model::aggregate_pdh_gpu_memory(&memory, &reading.luid)
        {
            reading.adapter_wide_dedicated_bytes = Some(dedicated);
            reading.adapter_wide_shared_bytes = Some(shared);
        }
        if let Some(value) = super::model::aggregate_pdh_gpu_engine(&engine, &reading.luid) {
            reading.engine_utilization_percent = Some(value);
            reading.engine_status = GpuEngineStatus::Available;
        }
    }
}

fn read_pdh_gpu_samples() -> Option<(Vec<PdhGpuMemorySample>, Vec<PdhGpuEngineSample>)> {
    let mut query = PDH_HQUERY::default();
    let status = unsafe { PdhOpenQueryW(PCWSTR::null(), 0, &mut query) };
    if status != 0 || query.is_invalid() {
        return None;
    }
    let result = (|| {
        let dedicated = add_pdh_counter(query, "\\GPU Adapter Memory(*)\\Dedicated Usage")?;
        let shared = add_pdh_counter(query, "\\GPU Adapter Memory(*)\\Shared Usage")?;
        let engine = add_pdh_counter(query, "\\GPU Engine(*)\\Utilization Percentage")?;
        if unsafe { PdhCollectQueryData(query) } != 0 {
            return None;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
        if unsafe { PdhCollectQueryData(query) } != 0 {
            return None;
        }
        let dedicated_values = read_pdh_array(dedicated, PdhValueKind::Large)?;
        let shared_values = read_pdh_array(shared, PdhValueKind::Large)?;
        let engine_values = read_pdh_array(engine, PdhValueKind::Double)?;
        let mut memory = merge_memory_samples(
            parse_pdh_memory_values(dedicated_values, true),
            parse_pdh_memory_values(shared_values, false),
        );
        memory.retain(|sample| sample.dedicated_bytes.is_some() || sample.shared_bytes.is_some());
        let engine = engine_values
            .into_iter()
            .filter_map(|(name, value)| {
                Some(PdhGpuEngineSample {
                    luid: super::model::normalize_luid_instance(&name)?,
                    utilization_percent: value,
                })
            })
            .collect();
        Some((memory, engine))
    })();
    unsafe {
        PdhCloseQuery(query);
    }
    result
}

fn add_pdh_counter(query: PDH_HQUERY, path: &str) -> Option<PDH_HCOUNTER> {
    let path: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
    let mut counter = PDH_HCOUNTER::default();
    let status = unsafe { PdhAddEnglishCounterW(query, PCWSTR(path.as_ptr()), 0, &mut counter) };
    (status == 0 && !counter.is_invalid()).then_some(counter)
}

#[derive(Clone, Copy)]
enum PdhValueKind {
    Large,
    Double,
}

fn read_pdh_array(counter: PDH_HCOUNTER, kind: PdhValueKind) -> Option<Vec<(String, f64)>> {
    let format = match kind {
        PdhValueKind::Large => PDH_FMT_LARGE,
        PdhValueKind::Double => PDH_FMT_DOUBLE,
    };
    let mut buffer_size = 0u32;
    let mut item_count = 0u32;
    let status = unsafe {
        PdhGetFormattedCounterArrayW(counter, format, &mut buffer_size, &mut item_count, None)
    };
    if status != PDH_MORE_DATA || buffer_size == 0 || item_count == 0 {
        return None;
    }
    let mut buffer = vec![MaybeUninit::<u8>::uninit(); buffer_size as usize];
    let status = unsafe {
        PdhGetFormattedCounterArrayW(
            counter,
            format,
            &mut buffer_size,
            &mut item_count,
            Some(buffer.as_mut_ptr().cast()),
        )
    };
    if status != 0 {
        return None;
    }
    let items = unsafe {
        std::slice::from_raw_parts(
            buffer.as_ptr().cast::<PDH_FMT_COUNTERVALUE_ITEM_W>(),
            item_count as usize,
        )
    };
    Some(
        items
            .iter()
            .filter_map(|item| {
                if item.szName.is_null() || item.FmtValue.CStatus != 0 {
                    return None;
                }
                let name = unsafe { item.szName.to_string().ok()? };
                let value = match kind {
                    PdhValueKind::Large => unsafe { item.FmtValue.Anonymous.largeValue as f64 },
                    PdhValueKind::Double => unsafe { item.FmtValue.Anonymous.doubleValue },
                };
                value.is_finite().then_some((name, value))
            })
            .collect(),
    )
}

fn parse_pdh_memory_values(values: Vec<(String, f64)>, dedicated: bool) -> Vec<PdhGpuMemorySample> {
    values
        .into_iter()
        .filter_map(|(name, value)| {
            let luid = super::model::normalize_luid_instance(&name)?;
            let bytes = (value >= 0.0).then_some(value as u64)?;
            Some(PdhGpuMemorySample {
                luid,
                dedicated_bytes: dedicated.then_some(bytes),
                shared_bytes: (!dedicated).then_some(bytes),
            })
        })
        .collect()
}

fn merge_memory_samples(
    dedicated: Vec<PdhGpuMemorySample>,
    shared: Vec<PdhGpuMemorySample>,
) -> Vec<PdhGpuMemorySample> {
    let mut merged = Vec::new();
    for sample in dedicated.into_iter().chain(shared) {
        if let Some(existing) = merged
            .iter_mut()
            .find(|item: &&mut PdhGpuMemorySample| item.luid == sample.luid)
        {
            existing.dedicated_bytes = existing.dedicated_bytes.or(sample.dedicated_bytes);
            existing.shared_bytes = existing.shared_bytes.or(sample.shared_bytes);
        } else {
            merged.push(sample);
        }
    }
    merged
}

fn query_video_memory(
    adapter: &IDXGIAdapter3,
    segment: windows::Win32::Graphics::Dxgi::DXGI_MEMORY_SEGMENT_GROUP,
) -> Option<GpuMemoryReading> {
    let mut info = DXGI_QUERY_VIDEO_MEMORY_INFO::default();
    unsafe { adapter.QueryVideoMemoryInfo(0, segment, &mut info).ok()? };
    gpu_memory_reading(info.Budget, info.CurrentUsage)
}

fn utf16_string(value: &[u16]) -> String {
    let end = value
        .iter()
        .position(|character| *character == 0)
        .unwrap_or(value.len());
    String::from_utf16_lossy(&value[..end])
}

fn format_luid(value: LUID) -> String {
    format!("{:08X}:{:08X}", value.HighPart as u32, value.LowPart)
}

fn unix_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}
