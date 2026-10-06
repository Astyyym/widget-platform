use super::model::{
    aggregate_pdh_gpu_engine, aggregate_pdh_gpu_memory, cpu_delta_percent, cpu_status_for_sample,
    memory_reading, normalize_luid_instance, CpuStatus, CpuTimes, MemoryStatus, MetricsSnapshot,
    PdhGpuEngineSample, PdhGpuMemorySample,
};

#[test]
fn first_cpu_sample_has_no_percentage() {
    let current = CpuTimes {
        idle: 150,
        kernel: 260,
        user: 140,
    };
    assert_eq!(cpu_delta_percent(None, current), None);
    assert_eq!(
        cpu_status_for_sample(Some(8), true, None),
        CpuStatus::WarmingUp
    );
}

#[test]
fn cpu_percentage_subtracts_idle_from_kernel_included_total() {
    let previous = CpuTimes {
        idle: 100,
        kernel: 200,
        user: 100,
    };
    let current = CpuTimes {
        idle: 140,
        kernel: 260,
        user: 140,
    };
    assert_eq!(cpu_delta_percent(Some(previous), current), Some(60.0));
}

#[test]
fn cpu_counter_regression_or_zero_interval_is_unavailable() {
    let current = CpuTimes {
        idle: 100,
        kernel: 200,
        user: 100,
    };
    assert_eq!(cpu_delta_percent(Some(current), current), None);
    let regressed = CpuTimes {
        idle: 99,
        ..current
    };
    assert_eq!(cpu_delta_percent(Some(current), regressed), None);
}

#[test]
fn processor_group_boundary_never_reports_a_partial_value_as_whole_machine() {
    assert_eq!(
        cpu_status_for_sample(Some(65), true, Some(42.0)),
        CpuStatus::ProcessorGroupLimit
    );
}

#[test]
fn physical_memory_uses_total_minus_available_and_rejects_missing_data() {
    assert_eq!(
        memory_reading(32 * 1024, 12 * 1024),
        Some(super::model::MemoryReading {
            total_bytes: 32 * 1024,
            available_bytes: 12 * 1024,
            used_bytes: 20 * 1024,
            used_percent: 62.5,
        })
    );
    assert_eq!(memory_reading(0, 0), None);
    assert_eq!(memory_reading(10, 11), None);
}

#[test]
fn unavailable_metrics_serialize_as_null_not_zero_and_use_camel_case() {
    let snapshot = MetricsSnapshot::unavailable(2, 3);
    assert_eq!(snapshot.memory_status, MemoryStatus::Unavailable);
    let value = serde_json::to_value(snapshot).expect("serialize snapshot");
    assert_eq!(value["cpuUsagePercent"], serde_json::Value::Null);
    assert_eq!(value["memory"], serde_json::Value::Null);
    assert_eq!(value["gpus"], serde_json::json!([]));
    assert_eq!(value["observedAtMs"], 3);
}

#[test]
fn pdh_luid_instances_are_normalized_and_malformed_values_are_ignored() {
    assert_eq!(
        normalize_luid_instance("luid_0x00000000_0x0001209a_phys_0"),
        Some("00000000:0001209A".to_string())
    );
    assert_eq!(normalize_luid_instance("luid_0x12_0x34_phys_0"), None);
    assert_eq!(
        normalize_luid_instance("pid_123_luid_0x00000000_0x00000001_phys_0"),
        Some("00000000:00000001".to_string())
    );
}

#[test]
fn pdh_memory_aggregates_only_the_requested_adapter() {
    let samples = vec![
        PdhGpuMemorySample {
            luid: "A".into(),
            dedicated_bytes: Some(10),
            shared_bytes: Some(2),
        },
        PdhGpuMemorySample {
            luid: "A".into(),
            dedicated_bytes: Some(3),
            shared_bytes: None,
        },
        PdhGpuMemorySample {
            luid: "B".into(),
            dedicated_bytes: Some(99),
            shared_bytes: Some(99),
        },
    ];
    assert_eq!(aggregate_pdh_gpu_memory(&samples, "A"), Some((13, 2)));
    assert_eq!(aggregate_pdh_gpu_memory(&samples, "C"), None);
}

#[test]
fn pdh_engine_aggregation_ignores_invalid_values_and_clamps_total() {
    let samples = vec![
        PdhGpuEngineSample {
            luid: "A".into(),
            utilization_percent: 40.0,
        },
        PdhGpuEngineSample {
            luid: "A".into(),
            utilization_percent: 70.0,
        },
        PdhGpuEngineSample {
            luid: "A".into(),
            utilization_percent: f64::NAN,
        },
        PdhGpuEngineSample {
            luid: "B".into(),
            utilization_percent: 99.0,
        },
    ];
    assert_eq!(aggregate_pdh_gpu_engine(&samples, "A"), Some(100.0));
    assert_eq!(aggregate_pdh_gpu_engine(&samples, "C"), None);
}

#[cfg(target_os = "windows")]
#[test]
fn dxgi_process_usage_may_exceed_a_nonzero_budget() {
    let reading = super::model::gpu_memory_reading(8, 9).expect("over-budget is valid");
    assert_eq!(reading.budget_bytes, 8);
    assert_eq!(reading.process_usage_bytes, 9);
    assert!(super::model::gpu_memory_reading(0, 0).is_none());
}
