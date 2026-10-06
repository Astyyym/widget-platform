use super::model::{
    CurrentWeather, DailyWeather, WeatherError, WeatherLocation, WeatherPoint, WeatherSnapshot,
};
use reqwest::Url;
use serde::Deserialize;
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

const FORECAST_ENDPOINT: &str = "https://api.open-meteo.com/v1/forecast";
const MAX_RESPONSE_BYTES: usize = 512 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

pub(super) fn build_forecast_url(location: &WeatherLocation) -> Result<Url, WeatherError> {
    location.validate()?;
    Url::parse_with_params(
        FORECAST_ENDPOINT,
        [
            ("latitude", location.latitude.to_string()),
            ("longitude", location.longitude.to_string()),
            ("current", "temperature_2m,weather_code".into()),
            (
                "daily",
                "weather_code,temperature_2m_max,temperature_2m_min".into(),
            ),
            ("hourly", "temperature_2m,weather_code".into()),
            ("forecast_days", "2".into()),
            ("timeformat", "unixtime".into()),
            ("timezone", location.timezone.clone()),
            (
                "temperature_unit",
                location.temperature_unit.query_value().into(),
            ),
        ],
    )
    .map_err(|_| WeatherError::new("invalidLocation", "天气请求地址无法建立。", false))
}

#[derive(Deserialize)]
struct OpenMeteoResponse {
    timezone: String,
    current_units: CurrentUnits,
    current: ProviderCurrent,
    hourly_units: HourlyUnits,
    hourly: ProviderHourly,
    daily_units: DailyUnits,
    daily: ProviderDaily,
}

#[derive(Deserialize)]
struct CurrentUnits {
    temperature_2m: String,
}

#[derive(Deserialize)]
struct HourlyUnits {
    temperature_2m: String,
}

#[derive(Deserialize)]
struct DailyUnits {
    temperature_2m_max: String,
    temperature_2m_min: String,
}

#[derive(Deserialize)]
struct ProviderCurrent {
    time: i64,
    temperature_2m: f64,
    weather_code: i64,
}

#[derive(Deserialize)]
struct ProviderHourly {
    time: Vec<i64>,
    temperature_2m: Vec<f64>,
    weather_code: Vec<i64>,
}

#[derive(Deserialize)]
struct ProviderDaily {
    weather_code: Vec<i64>,
    temperature_2m_max: Vec<f64>,
    temperature_2m_min: Vec<f64>,
}

fn epoch_millis(seconds: i64) -> Result<u64, WeatherError> {
    let seconds = u64::try_from(seconds).map_err(|_| WeatherError::invalid_response())?;
    seconds
        .checked_mul(1_000)
        .ok_or_else(WeatherError::invalid_response)
}

fn weather_code(value: i64) -> Result<u16, WeatherError> {
    u16::try_from(value).map_err(|_| WeatherError::invalid_response())
}

fn finite(value: f64) -> Result<f64, WeatherError> {
    value
        .is_finite()
        .then_some(value)
        .ok_or_else(WeatherError::invalid_response)
}

pub(super) fn append_bounded_chunk(body: &mut Vec<u8>, chunk: &[u8]) -> Result<(), WeatherError> {
    if chunk.len() > MAX_RESPONSE_BYTES.saturating_sub(body.len()) {
        return Err(WeatherError::invalid_response());
    }
    body.extend_from_slice(chunk);
    Ok(())
}

pub(super) fn parse_open_meteo_response(
    bytes: &[u8],
    location: WeatherLocation,
    _received_at_ms: u64,
) -> Result<WeatherSnapshot, WeatherError> {
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err(WeatherError::invalid_response());
    }
    let parsed: OpenMeteoResponse =
        serde_json::from_slice(bytes).map_err(|_| WeatherError::invalid_response())?;
    if parsed.timezone != location.timezone {
        return Err(WeatherError::invalid_response());
    }
    let expected_unit = location.temperature_unit.provider_symbol();
    if parsed.current_units.temperature_2m != expected_unit
        || parsed.hourly_units.temperature_2m != expected_unit
        || parsed.daily_units.temperature_2m_max != expected_unit
        || parsed.daily_units.temperature_2m_min != expected_unit
    {
        return Err(WeatherError::invalid_response());
    }
    if parsed.hourly.time.is_empty()
        || parsed.hourly.time.len() != parsed.hourly.temperature_2m.len()
        || parsed.hourly.time.len() != parsed.hourly.weather_code.len()
        || parsed.hourly.time.len() > 48
        || parsed.daily.weather_code.is_empty()
        || parsed.daily.temperature_2m_max.is_empty()
        || parsed.daily.temperature_2m_min.is_empty()
    {
        return Err(WeatherError::invalid_response());
    }

    let hourly = parsed
        .hourly
        .time
        .into_iter()
        .zip(parsed.hourly.temperature_2m)
        .zip(parsed.hourly.weather_code)
        .map(|((time, temperature), code)| {
            Ok(WeatherPoint {
                at_ms: epoch_millis(time)?,
                temperature: finite(temperature)?,
                weather_code: weather_code(code)?,
            })
        })
        .collect::<Result<Vec<_>, WeatherError>>()?;
    let high_temperature = finite(parsed.daily.temperature_2m_max[0])?;
    let low_temperature = finite(parsed.daily.temperature_2m_min[0])?;
    if low_temperature > high_temperature {
        return Err(WeatherError::invalid_response());
    }

    Ok(WeatherSnapshot {
        schema_version: 1,
        source: "Open-Meteo".into(),
        location,
        provider_timezone: parsed.timezone,
        observed_at_ms: epoch_millis(parsed.current.time)?,
        current: CurrentWeather {
            temperature: finite(parsed.current.temperature_2m)?,
            weather_code: weather_code(parsed.current.weather_code)?,
        },
        daily: DailyWeather {
            high_temperature,
            low_temperature,
            weather_code: weather_code(parsed.daily.weather_code[0])?,
        },
        hourly,
    })
}

pub(super) async fn fetch_open_meteo(
    client: &reqwest::Client,
    location: WeatherLocation,
    cancellation: Arc<AtomicBool>,
) -> Result<WeatherSnapshot, WeatherError> {
    let url = build_forecast_url(&location)?;
    let mut response = cancellable_request(
        client
            .get(url)
            .timeout(REQUEST_TIMEOUT)
            .header(reqwest::header::ACCEPT, "application/json")
            .send(),
        &cancellation,
    )
    .await?;
    if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(WeatherError::new(
            "rateLimited",
            "天气服务暂时限制了请求频率。",
            true,
        ));
    }
    if !response.status().is_success() {
        return Err(WeatherError::new("network", "天气服务暂时不可用。", true));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err(WeatherError::invalid_response());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = cancellable_request(response.chunk(), &cancellation).await? {
        append_bounded_chunk(&mut bytes, &chunk)?;
    }
    parse_open_meteo_response(&bytes, location, current_time_millis())
}

async fn cancellable_request<F, T>(
    future: F,
    cancellation: &Arc<AtomicBool>,
) -> Result<T, WeatherError>
where
    F: Future<Output = Result<T, reqwest::Error>>,
{
    tokio::pin!(future);
    loop {
        if cancellation.load(Ordering::SeqCst) {
            return Err(WeatherError::new("cancelled", "天气请求已取消。", true));
        }
        tokio::select! {
            result = &mut future => {
                return result.map_err(|_| WeatherError::new(
                    "network",
                    "天气网络请求失败。",
                    true,
                ));
            }
            _ = tokio::time::sleep(Duration::from_millis(50)) => {}
        }
    }
}

fn current_time_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}
