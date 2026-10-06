use super::model::{TemperatureUnit, WeatherError, WeatherLocation};
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::time::Duration;

const ENDPOINT: &str = "https://geocoding-api.open-meteo.com/v1/search";
const MAX_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherCity {
    pub name: String,
    pub latitude: f64,
    pub longitude: f64,
    pub timezone: String,
    pub label: String,
}

#[derive(Deserialize)]
struct Response {
    #[serde(default)]
    results: Vec<ProviderCity>,
    #[serde(default)]
    error: bool,
}
#[derive(Deserialize)]
struct ProviderCity {
    name: String,
    latitude: f64,
    longitude: f64,
    timezone: String,
    #[serde(default)]
    admin1: String,
    #[serde(default)]
    country: String,
}

fn search_url(name: &str) -> Result<Url, WeatherError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(WeatherError::new(
            "invalidLocation",
            "城市名称不能为空，且最多 80 个字符。",
            false,
        ));
    }
    Url::parse_with_params(
        ENDPOINT,
        [
            ("name", name),
            ("count", "10"),
            ("language", "zh"),
            ("format", "json"),
        ],
    )
    .map_err(|_| WeatherError::invalid_response())
}

fn parse_cities(bytes: &[u8]) -> Result<Vec<WeatherCity>, WeatherError> {
    if bytes.len() > MAX_BYTES {
        return Err(WeatherError::invalid_response());
    }
    let response: Response =
        serde_json::from_slice(bytes).map_err(|_| WeatherError::invalid_response())?;
    if response.error || response.results.len() > 10 {
        return Err(WeatherError::invalid_response());
    }
    let mut seen = HashSet::new();
    let mut cities = Vec::new();
    for city in response.results {
        let location = WeatherLocation {
            name: city.name.clone(),
            latitude: city.latitude,
            longitude: city.longitude,
            timezone: city.timezone.clone(),
            temperature_unit: TemperatureUnit::Celsius,
        };
        location
            .validate()
            .map_err(|_| WeatherError::invalid_response())?;
        if !seen.insert((city.latitude.to_bits(), city.longitude.to_bits())) {
            continue;
        }
        let label = [&city.name, &city.admin1, &city.country]
            .into_iter()
            .filter(|part| !part.is_empty())
            .cloned()
            .collect::<Vec<_>>()
            .join(" · ");
        if label.chars().count() > 300 {
            return Err(WeatherError::invalid_response());
        }
        cities.push(WeatherCity {
            name: city.name,
            latitude: city.latitude,
            longitude: city.longitude,
            timezone: city.timezone,
            label,
        });
    }
    Ok(cities)
}

pub(super) async fn search_cities(
    client: &Client,
    name: &str,
) -> Result<Vec<WeatherCity>, WeatherError> {
    let url = search_url(name)?;
    // Whole operation is bounded, including a trickling response body.
    tokio::time::timeout(Duration::from_secs(10), async {
        let mut response = client.get(url).send().await.map_err(|_| {
            WeatherError::new("transportError", "城市查询失败，请检查网络后重试。", true)
        })?;
        if response.status().as_u16() == 429 {
            return Err(WeatherError::new(
                "rateLimited",
                "城市查询过于频繁，请稍后重试。",
                true,
            ));
        }
        if !response.status().is_success()
            || response
                .content_length()
                .is_some_and(|length| length > MAX_BYTES as u64)
        {
            return Err(WeatherError::invalid_response());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| WeatherError::invalid_response())?
        {
            if chunk.len() > MAX_BYTES.saturating_sub(bytes.len()) {
                return Err(WeatherError::invalid_response());
            }
            bytes.extend_from_slice(&chunk);
        }
        parse_cities(&bytes)
    })
    .await
    .map_err(|_| WeatherError::new("timeout", "城市查询超时，请重试。", true))?
}

/// Resolves a human-readable place name for a coordinate via Open-Meteo's
/// geocoding endpoint. Returns the nearest named place (down to county level);
/// `None` means the provider had no name for this point, so the caller keeps a
/// generic label instead of failing the whole location.
pub(super) async fn reverse_name(
    client: &Client,
    latitude: f64,
    longitude: f64,
) -> Result<Option<String>, WeatherError> {
    if !latitude.is_finite()
        || !(-90.0..=90.0).contains(&latitude)
        || !longitude.is_finite()
        || !(-180.0..=180.0).contains(&longitude)
    {
        return Err(WeatherError::new(
            "invalidLocation",
            "定位坐标无效。",
            false,
        ));
    }
    let url = Url::parse_with_params(
        ENDPOINT,
        [
            ("latitude".to_string(), latitude.to_string()),
            ("longitude".to_string(), longitude.to_string()),
            ("count".to_string(), "1".to_string()),
            ("language".to_string(), "zh".to_string()),
            ("format".to_string(), "json".to_string()),
        ],
    )
    .map_err(|_| WeatherError::invalid_response())?;
    let bytes = tokio::time::timeout(Duration::from_secs(10), async {
        let mut response = client.get(url).send().await.map_err(|_| {
            WeatherError::new(
                "transportError",
                "定位城市名查询失败，请检查网络后重试。",
                true,
            )
        })?;
        if response.status().as_u16() == 429 {
            return Err(WeatherError::new(
                "rateLimited",
                "定位城市名查询过于频繁，请稍后重试。",
                true,
            ));
        }
        if !response.status().is_success()
            || response
                .content_length()
                .is_some_and(|length| length > MAX_BYTES as u64)
        {
            return Err(WeatherError::invalid_response());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| WeatherError::invalid_response())?
        {
            if chunk.len() > MAX_BYTES.saturating_sub(bytes.len()) {
                return Err(WeatherError::invalid_response());
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok::<Vec<u8>, WeatherError>(bytes)
    })
    .await
    .map_err(|_| WeatherError::new("timeout", "定位城市名查询超时，请重试。", true))??;
    Ok(parse_cities(&bytes)?
        .into_iter()
        .next()
        .map(|city| city.name))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn city_results_include_internal_location_and_disambiguation() {
        let bytes = r#"{"results":[{"name":"杭州","latitude":30.27,"longitude":120.15,"timezone":"Asia/Shanghai","admin1":"浙江省","country":"中国"}]}"#;
        let cities = parse_cities(bytes.as_bytes()).unwrap();
        assert_eq!(cities.len(), 1);
        assert_eq!(cities[0].timezone, "Asia/Shanghai");
        assert_eq!(cities[0].label, "杭州 · 浙江省 · 中国");
    }
    #[test]
    fn search_is_encoded_and_empty_names_are_rejected() {
        assert!(search_url(" ").is_err());
        let url = search_url("杭州, 中国").unwrap();
        assert_eq!(
            url.query_pairs().find(|(key, _)| key == "name").unwrap().1,
            "杭州, 中国"
        );
    }
    #[test]
    fn no_results_does_not_create_a_location() {
        assert!(parse_cities(b"{}").unwrap().is_empty());
        assert!(parse_cities(b"{\"error\":true}").is_err());
    }
    #[test]
    fn invalid_location_and_oversize_are_rejected() {
        assert!(parse_cities(b"{\"results\":[{\"name\":\"test\",\"latitude\":91,\"longitude\":0,\"timezone\":\"UTC\"}]}").is_err());
        assert!(parse_cities(&vec![b' '; MAX_BYTES + 1]).is_err());
    }
}
