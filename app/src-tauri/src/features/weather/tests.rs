use super::model::{TemperatureUnit, WeatherLocation};
use super::open_meteo::{
    append_bounded_chunk, build_forecast_url, fetch_open_meteo, parse_open_meteo_response,
};
use super::runtime::{
    cache_file_is_bounded, BeginWeatherRead, WeatherRuntime, WEATHER_REFRESH_INTERVAL,
};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn test_cache_path() -> PathBuf {
    let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let directory = std::env::temp_dir().join(format!(
        "widget-platform-weather-test-{}-{sequence}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&directory);
    fs::create_dir_all(&directory).expect("test cache directory should exist");
    directory.join("weather-cache.json")
}

fn location(unit: TemperatureUnit) -> WeatherLocation {
    WeatherLocation {
        name: "测试城市".into(),
        latitude: 30.2741,
        longitude: 120.1551,
        timezone: "Asia/Shanghai".into(),
        temperature_unit: unit,
    }
}

#[test]
fn location_requires_explicit_valid_coordinates_timezone_and_unit() {
    assert!(location(TemperatureUnit::Celsius).validate().is_ok());

    let mut invalid = location(TemperatureUnit::Celsius);
    invalid.latitude = 91.0;
    assert_eq!(invalid.validate().unwrap_err().code, "invalidLocation");

    let mut automatic = location(TemperatureUnit::Celsius);
    automatic.timezone = "auto".into();
    assert_eq!(automatic.validate().unwrap_err().code, "invalidLocation");

    let mut nonexistent = location(TemperatureUnit::Celsius);
    nonexistent.timezone = "Foo/Bar".into();
    assert_eq!(nonexistent.validate().unwrap_err().code, "invalidLocation");
}

#[test]
fn forecast_url_requests_current_daily_and_hourly_in_one_call() {
    let url = build_forecast_url(&location(TemperatureUnit::Fahrenheit)).expect("URL should build");
    let query = url.query().expect("query should exist");

    assert!(query.contains("current=temperature_2m%2Cweather_code"));
    assert!(query.contains("daily=weather_code%2Ctemperature_2m_max%2Ctemperature_2m_min"));
    assert!(query.contains("hourly=temperature_2m%2Cweather_code"));
    assert!(query.contains("timezone=Asia%2FShanghai"));
    assert!(query.contains("temperature_unit=fahrenheit"));
    assert!(query.contains("forecast_days=2"));
    assert!(query.contains("timeformat=unixtime"));
}

#[test]
fn open_meteo_response_is_normalized_without_replacing_provider_time() {
    let raw = include_str!("../../../../tests/fixtures/weather/open-meteo-success.json");
    let snapshot = parse_open_meteo_response(
        raw.as_bytes(),
        location(TemperatureUnit::Celsius),
        1_790_557_200_123,
    )
    .expect("fixture should parse");

    assert_eq!(snapshot.source, "Open-Meteo");
    assert_eq!(snapshot.provider_timezone, "Asia/Shanghai");
    assert_eq!(snapshot.observed_at_ms, 1_790_557_200_000);
    assert_eq!(snapshot.current.temperature, 22.4);
    assert_eq!(snapshot.daily.high_temperature, 26.1);
    assert_eq!(snapshot.daily.low_temperature, 17.8);
    assert_eq!(snapshot.hourly.len(), 3);
    assert_eq!(snapshot.hourly[2].at_ms, 1_790_564_400_000);
}

#[test]
fn malformed_provider_arrays_are_rejected() {
    let raw = include_str!("../../../../tests/fixtures/weather/open-meteo-success.json");
    let malformed = raw.replacen("\"weather_code\": [1, 2, 3]", "\"weather_code\": [1, 2]", 1);
    let error = parse_open_meteo_response(
        malformed.as_bytes(),
        location(TemperatureUnit::Celsius),
        1_790_557_200_123,
    )
    .unwrap_err();

    assert_eq!(error.code, "invalidResponse");
}

#[test]
fn response_body_limit_rejects_a_chunk_before_extending_the_buffer() {
    let mut body = vec![0; 512 * 1024 - 1];
    let error = append_bounded_chunk(&mut body, &[1, 2]).unwrap_err();

    assert_eq!(error.code, "invalidResponse");
    assert_eq!(body.len(), 512 * 1024 - 1);
}

#[test]
fn successful_read_is_cached_and_not_repeated_before_thirty_minutes() {
    let cache_path = test_cache_path();
    let runtime = WeatherRuntime::new(cache_path.clone());
    let now = Instant::now();
    let now_ms = 1_790_557_200_123;
    let raw = include_str!("../../../../tests/fixtures/weather/open-meteo-success.json");
    let snapshot =
        parse_open_meteo_response(raw.as_bytes(), location(TemperatureUnit::Celsius), now_ms)
            .expect("fixture should parse");

    let ticket = match runtime
        .begin(location(TemperatureUnit::Celsius), now_ms, now)
        .expect("first read should begin")
    {
        BeginWeatherRead::Fetch(ticket) => ticket,
        BeginWeatherRead::Ready(_) => panic!("first read must fetch"),
    };
    let fresh = ticket.succeed(snapshot.clone(), now_ms, now);
    assert_eq!(fresh.quality, super::model::WeatherQuality::Fresh);

    let cached = runtime
        .begin(
            location(TemperatureUnit::Celsius),
            now_ms + 60_000,
            now + Duration::from_secs(60),
        )
        .expect("cached read should succeed");
    let BeginWeatherRead::Ready(cached) = cached else {
        panic!("cached read must not fetch");
    };
    assert_eq!(cached.snapshot, Some(snapshot));
    assert!(cached.retry_after_ms >= WEATHER_REFRESH_INTERVAL.as_millis() as u64 - 60_000);

    let reloaded = WeatherRuntime::new(cache_path.clone());
    let loaded = reloaded
        .begin(
            location(TemperatureUnit::Celsius),
            now_ms + 120_000,
            now + Duration::from_secs(120),
        )
        .expect("persisted cache should load");
    assert!(matches!(loaded, BeginWeatherRead::Ready(_)));
    fs::remove_dir_all(cache_path.parent().unwrap()).expect("test cache should be removed");
}

#[test]
fn failed_refresh_keeps_last_good_observation_and_applies_backoff() {
    let cache_path = test_cache_path();
    let runtime = WeatherRuntime::new(cache_path.clone());
    let now = Instant::now();
    let now_ms = 1_790_557_200_123;
    let raw = include_str!("../../../../tests/fixtures/weather/open-meteo-success.json");
    let snapshot =
        parse_open_meteo_response(raw.as_bytes(), location(TemperatureUnit::Celsius), now_ms)
            .expect("fixture should parse");
    let first = match runtime
        .begin(location(TemperatureUnit::Celsius), now_ms, now)
        .unwrap()
    {
        BeginWeatherRead::Fetch(ticket) => ticket,
        BeginWeatherRead::Ready(_) => panic!("first read must fetch"),
    };
    first.succeed(snapshot.clone(), now_ms, now);

    let due_at = now + WEATHER_REFRESH_INTERVAL;
    let due_ms = now_ms + WEATHER_REFRESH_INTERVAL.as_millis() as u64;
    let refresh = match runtime
        .begin(location(TemperatureUnit::Celsius), due_ms, due_at)
        .unwrap()
    {
        BeginWeatherRead::Fetch(ticket) => ticket,
        BeginWeatherRead::Ready(_) => panic!("expired cache must refresh"),
    };
    let stale = refresh.fail("network", due_ms, due_at);
    assert_eq!(stale.quality, super::model::WeatherQuality::Stale);
    assert_eq!(
        stale.snapshot.as_ref().unwrap().observed_at_ms,
        snapshot.observed_at_ms
    );
    assert_eq!(stale.failure_reason, Some("network"));
    assert!(stale.retry_after_ms >= 60_000);

    let during_backoff = runtime
        .begin(
            location(TemperatureUnit::Celsius),
            due_ms + 30_000,
            due_at + Duration::from_secs(30),
        )
        .unwrap();
    assert!(matches!(during_backoff, BeginWeatherRead::Ready(_)));
    fs::remove_dir_all(cache_path.parent().unwrap()).expect("test cache should be removed");
}

#[test]
fn changing_location_does_not_inherit_another_locations_refresh_cooldown() {
    let runtime = WeatherRuntime::memory_only();
    let now = Instant::now();
    let now_ms = 1_790_557_200_123;
    let raw = include_str!("../../../../tests/fixtures/weather/open-meteo-success.json");
    let first_location = location(TemperatureUnit::Celsius);
    let snapshot = parse_open_meteo_response(raw.as_bytes(), first_location.clone(), now_ms)
        .expect("fixture should parse");
    let first = match runtime.begin(first_location, now_ms, now).unwrap() {
        BeginWeatherRead::Fetch(ticket) => ticket,
        BeginWeatherRead::Ready(_) => panic!("first location must fetch"),
    };
    first.succeed(snapshot, now_ms, now);

    let mut second_location = location(TemperatureUnit::Celsius);
    second_location.name = "另一个城市".into();
    second_location.latitude = 31.2304;
    second_location.longitude = 121.4737;
    let second = runtime
        .begin(
            second_location,
            now_ms + 1_000,
            now + Duration::from_secs(1),
        )
        .expect("another location should not inherit the first location cooldown");

    assert!(matches!(second, BeginWeatherRead::Fetch(_)));
}

#[test]
fn cancellation_does_not_apply_backoff_and_allows_immediate_restart() {
    let runtime = WeatherRuntime::memory_only();
    let now = Instant::now();
    let now_ms = 1_790_557_200_123;
    let first = match runtime
        .begin(location(TemperatureUnit::Celsius), now_ms, now)
        .unwrap()
    {
        BeginWeatherRead::Fetch(ticket) => ticket,
        BeginWeatherRead::Ready(_) => panic!("first read must fetch"),
    };

    assert!(runtime.cancel_active(&location(TemperatureUnit::Celsius)));
    drop(first);

    let restarted = runtime
        .begin(
            location(TemperatureUnit::Celsius),
            now_ms + 1,
            now + Duration::from_millis(1),
        )
        .expect("cancelled reads should be immediately restartable");
    assert!(matches!(restarted, BeginWeatherRead::Fetch(_)));
}

#[test]
fn scoped_cancel_for_an_old_location_does_not_cancel_the_new_request() {
    let runtime = WeatherRuntime::memory_only();
    let now = Instant::now();
    let now_ms = 1_790_557_200_123;
    let first_location = location(TemperatureUnit::Celsius);
    let first = match runtime.begin(first_location.clone(), now_ms, now).unwrap() {
        BeginWeatherRead::Fetch(ticket) => ticket,
        BeginWeatherRead::Ready(_) => panic!("first location must fetch"),
    };
    let mut second_location = first_location.clone();
    second_location.name = "另一个城市".into();
    second_location.latitude = 31.2304;
    second_location.longitude = 121.4737;
    let second = match runtime
        .begin(
            second_location.clone(),
            now_ms + 1,
            now + Duration::from_millis(1),
        )
        .unwrap()
    {
        BeginWeatherRead::Fetch(ticket) => ticket,
        BeginWeatherRead::Ready(_) => panic!("second location must fetch"),
    };

    assert!(!runtime.cancel_active(&first_location));
    assert!(runtime
        .begin(
            second_location.clone(),
            now_ms + 2,
            now + Duration::from_millis(2),
        )
        .is_err());
    assert!(runtime.cancel_active(&second_location));
    let raw = include_str!("../../../../tests/fixtures/weather/open-meteo-success.json");
    let old_snapshot = parse_open_meteo_response(raw.as_bytes(), first_location, now_ms)
        .expect("fixture should parse");
    let old_result = first.succeed(old_snapshot, now_ms + 3, now + Duration::from_millis(3));
    assert_ne!(old_result.quality, super::model::WeatherQuality::Fresh);
    drop(second);
}

#[test]
fn future_dated_cache_is_not_reported_as_fresh() {
    let runtime = WeatherRuntime::memory_only();
    let now = Instant::now();
    let now_ms = 1_790_557_200_123;
    let raw = include_str!("../../../../tests/fixtures/weather/open-meteo-success.json");
    let requested_location = location(TemperatureUnit::Celsius);
    let snapshot = parse_open_meteo_response(raw.as_bytes(), requested_location.clone(), now_ms)
        .expect("fixture should parse");
    let first = match runtime
        .begin(requested_location.clone(), now_ms, now)
        .unwrap()
    {
        BeginWeatherRead::Fetch(ticket) => ticket,
        BeginWeatherRead::Ready(_) => panic!("first read must fetch"),
    };
    first.succeed(snapshot, now_ms + 3_600_000, now);

    let reread = runtime
        .begin(requested_location, now_ms, now + Duration::from_secs(1))
        .expect("future cache timestamps must be discarded");
    assert!(matches!(reread, BeginWeatherRead::Fetch(_)));
}

#[test]
fn malformed_disk_cache_is_ignored() {
    let cache_path = test_cache_path();
    let runtime = WeatherRuntime::new(cache_path.clone());
    let now = Instant::now();
    let now_ms = 1_790_557_200_123;
    let raw = include_str!("../../../../tests/fixtures/weather/open-meteo-success.json");
    let requested_location = location(TemperatureUnit::Celsius);
    let snapshot = parse_open_meteo_response(raw.as_bytes(), requested_location.clone(), now_ms)
        .expect("fixture should parse");
    let first = match runtime
        .begin(requested_location.clone(), now_ms, now)
        .unwrap()
    {
        BeginWeatherRead::Fetch(ticket) => ticket,
        BeginWeatherRead::Ready(_) => panic!("first read must fetch"),
    };
    first.succeed(snapshot, now_ms, now);
    drop(runtime);

    let mut cached: serde_json::Value =
        serde_json::from_slice(&fs::read(&cache_path).expect("cache should be persisted"))
            .expect("cache should be valid JSON");
    cached["snapshot"]["hourly"] = serde_json::json!([]);
    fs::write(
        &cache_path,
        serde_json::to_vec(&cached).expect("cache should serialize"),
    )
    .expect("malformed cache fixture should be written");

    let reloaded = WeatherRuntime::new(cache_path.clone());
    let read = reloaded
        .begin(
            requested_location,
            now_ms + 1_000,
            now + Duration::from_secs(1),
        )
        .expect("malformed cache should be ignored");
    assert!(matches!(read, BeginWeatherRead::Fetch(_)));
    fs::remove_dir_all(cache_path.parent().unwrap()).expect("test cache should be removed");
}

#[test]
fn oversized_cache_file_is_rejected_before_loading() {
    let cache_path = test_cache_path();
    fs::write(&cache_path, vec![0; 1024 * 1024 + 1]).expect("oversized cache should be written");

    assert!(!cache_file_is_bounded(&cache_path));
    fs::remove_dir_all(cache_path.parent().unwrap()).expect("test cache should be removed");
}

#[test]
#[ignore = "requires explicit WIDGET_WEATHER_LIVE=1 authorization and external network"]
fn live_open_meteo_query_uses_a_fixed_public_coordinate() {
    assert_eq!(std::env::var("WIDGET_WEATHER_LIVE").as_deref(), Ok("1"));
    let client = reqwest::Client::new();
    let result = tauri::async_runtime::block_on(fetch_open_meteo(
        &client,
        WeatherLocation {
            name: "Berlin test coordinate".into(),
            latitude: 52.52,
            longitude: 13.41,
            timezone: "Europe/Berlin".into(),
            temperature_unit: TemperatureUnit::Celsius,
        },
        Arc::new(AtomicBool::new(false)),
    ))
    .expect("authorized live weather query should succeed");

    assert_eq!(result.source, "Open-Meteo");
    assert_eq!(result.provider_timezone, "Europe/Berlin");
    assert!(!result.hourly.is_empty());
}
