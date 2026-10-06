use super::model::{TemperatureUnit, WeatherError, WeatherLocation};

/// Raw coordinate result from the OS geolocation API, before any name lookup.
pub struct LocatedCoordinate {
    pub latitude: f64,
    pub longitude: f64,
    pub timezone: String,
}

#[cfg(windows)]
pub fn locate_coordinate() -> Result<LocatedCoordinate, WeatherError> {
    use windows::Devices::Geolocation::{GeolocationAccessStatus, Geolocator};
    use windows::Foundation::TimeSpan;

    let access = Geolocator::RequestAccessAsync()
        .map_err(|_| unavailable())?
        .get()
        .map_err(|_| unavailable())?;
    if access != GeolocationAccessStatus::Allowed {
        return Err(WeatherError::new(
            "permissionDenied",
            "Windows 未允许访问当前位置。",
            false,
        ));
    }
    let locator = Geolocator::new().map_err(|_| unavailable())?;
    let position = locator
        .GetGeopositionAsyncWithAgeAndTimeout(
            TimeSpan { Duration: 0 },
            TimeSpan {
                Duration: 10 * 10_000_000,
            },
        )
        .map_err(|_| unavailable())?
        .get()
        .map_err(|_| timeout())?;
    let coordinate = position.Coordinate().map_err(|_| unavailable())?;
    let latitude = coordinate.Latitude().map_err(|_| unavailable())?;
    let longitude = coordinate.Longitude().map_err(|_| unavailable())?;
    let timezone = iana_time_zone::get_timezone().map_err(|_| unavailable())?;
    Ok(LocatedCoordinate {
        latitude,
        longitude,
        timezone,
    })
}

#[cfg(not(windows))]
pub fn locate_coordinate() -> Result<LocatedCoordinate, WeatherError> {
    Err(unavailable())
}

/// Builds a validated location from a coordinate plus an optional provider name.
/// A missing name (provider had no match, or the lookup failed) falls back to the
/// generic "当前位置" label so the weather read still succeeds.
pub fn location_from_coordinate(
    coordinate: LocatedCoordinate,
    name: Option<String>,
    unit: TemperatureUnit,
) -> Result<WeatherLocation, WeatherError> {
    let trimmed = name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value.chars().count() <= 80);
    let location = WeatherLocation {
        name: trimmed.unwrap_or_else(|| "当前位置".to_string()),
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        timezone: coordinate.timezone,
        temperature_unit: unit,
    };
    location.validate()?;
    Ok(location)
}

fn unavailable() -> WeatherError {
    WeatherError::new("locationUnavailable", "Windows 定位当前不可用。", true)
}

fn timeout() -> WeatherError {
    WeatherError::new("timeout", "获取当前位置超时，请重试。", true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn location_failure_codes_are_user_visible_and_retryable_only_when_transient() {
        assert_eq!(unavailable().code, "locationUnavailable");
        assert_eq!(timeout().code, "timeout");
        assert!(!WeatherError::new("permissionDenied", "denied", false).retryable);
    }

    fn coordinate() -> LocatedCoordinate {
        LocatedCoordinate {
            latitude: 30.0,
            longitude: 120.0,
            timezone: "Asia/Shanghai".to_string(),
        }
    }

    #[test]
    fn reverse_name_is_used_when_present_and_trimmed() {
        let location = location_from_coordinate(
            coordinate(),
            Some("  临安区  ".to_string()),
            TemperatureUnit::Celsius,
        )
        .unwrap();
        assert_eq!(location.name, "临安区");
    }

    #[test]
    fn missing_or_blank_name_falls_back_to_current_position_label() {
        for name in [None, Some("".to_string()), Some("   ".to_string())] {
            let location =
                location_from_coordinate(coordinate(), name, TemperatureUnit::Celsius).unwrap();
            assert_eq!(location.name, "当前位置");
        }
    }

    #[test]
    fn oversized_provider_name_is_rejected_in_favor_of_the_fallback() {
        let location =
            location_from_coordinate(coordinate(), Some("x".repeat(81)), TemperatureUnit::Celsius)
                .unwrap();
        assert_eq!(location.name, "当前位置");
    }
}
