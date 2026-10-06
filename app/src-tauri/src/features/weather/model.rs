use serde::{Deserialize, Serialize};
use std::str::FromStr;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TemperatureUnit {
    Celsius,
    Fahrenheit,
}

impl TemperatureUnit {
    pub(super) fn query_value(self) -> &'static str {
        match self {
            Self::Celsius => "celsius",
            Self::Fahrenheit => "fahrenheit",
        }
    }

    pub(super) fn provider_symbol(self) -> &'static str {
        match self {
            Self::Celsius => "°C",
            Self::Fahrenheit => "°F",
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WeatherLocation {
    pub name: String,
    pub latitude: f64,
    pub longitude: f64,
    pub timezone: String,
    pub temperature_unit: TemperatureUnit,
}

impl WeatherLocation {
    pub fn validate(&self) -> Result<(), WeatherError> {
        let name = self.name.trim();
        if name.is_empty()
            || name.chars().count() > 80
            || !self.latitude.is_finite()
            || !(-90.0..=90.0).contains(&self.latitude)
            || !self.longitude.is_finite()
            || !(-180.0..=180.0).contains(&self.longitude)
            || !is_iana_timezone(&self.timezone)
        {
            return Err(WeatherError::new(
                "invalidLocation",
                "天气位置必须包含有效的城市名、经纬度和明确 IANA 时区。",
                false,
            ));
        }
        Ok(())
    }
}

fn is_iana_timezone(value: &str) -> bool {
    value != "auto" && chrono_tz::Tz::from_str(value).is_ok()
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherPoint {
    pub at_ms: u64,
    pub temperature: f64,
    pub weather_code: u16,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentWeather {
    pub temperature: f64,
    pub weather_code: u16,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyWeather {
    pub high_temperature: f64,
    pub low_temperature: f64,
    pub weather_code: u16,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherSnapshot {
    pub schema_version: u8,
    pub source: String,
    pub location: WeatherLocation,
    pub provider_timezone: String,
    pub observed_at_ms: u64,
    pub current: CurrentWeather,
    pub daily: DailyWeather,
    pub hourly: Vec<WeatherPoint>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WeatherQuality {
    Fresh,
    Stale,
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherReadState {
    pub schema_version: u8,
    pub quality: WeatherQuality,
    pub snapshot: Option<WeatherSnapshot>,
    pub failure_reason: Option<&'static str>,
    pub retry_after_ms: u64,
    pub last_attempt_at_ms: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherError {
    pub code: &'static str,
    pub message: &'static str,
    pub retryable: bool,
}

impl WeatherError {
    pub fn new(code: &'static str, message: &'static str, retryable: bool) -> Self {
        Self {
            code,
            message,
            retryable,
        }
    }

    pub(super) fn invalid_response() -> Self {
        Self::new("invalidResponse", "天气服务返回了无法识别的数据。", true)
    }
}
