use super::model::{WeatherError, WeatherLocation, WeatherReadState};
use super::open_meteo::fetch_open_meteo;
use super::runtime::{BeginWeatherRead, WeatherRuntime};
use std::time::Instant;
use tauri::State;

#[tauri::command]
pub async fn weather_search_cities(
    runtime: State<'_, WeatherRuntime>,
    name: String,
) -> Result<Vec<super::geocoding::WeatherCity>, WeatherError> {
    super::geocoding::search_cities(&runtime.client(), &name).await
}

#[tauri::command]
pub async fn weather_locate(
    runtime: State<'_, WeatherRuntime>,
    unit: super::model::TemperatureUnit,
) -> Result<WeatherLocation, WeatherError> {
    let coordinate = super::location::locate_coordinate()?;
    // Reverse name lookup is best-effort: a provider miss or failure keeps the
    // generic "当前位置" label instead of blocking the weather read.
    let name = super::geocoding::reverse_name(
        &runtime.client(),
        coordinate.latitude,
        coordinate.longitude,
    )
    .await
    .unwrap_or(None);
    super::location::location_from_coordinate(coordinate, name, unit)
}

#[tauri::command]
pub async fn weather_read(
    runtime: State<'_, WeatherRuntime>,
    location: WeatherLocation,
) -> Result<WeatherReadState, WeatherError> {
    let now = Instant::now();
    let now_ms = current_time_millis();
    match runtime.begin(location.clone(), now_ms, now)? {
        BeginWeatherRead::Ready(state) => Ok(state),
        BeginWeatherRead::Fetch(ticket) => {
            let cancellation = ticket.cancellation();
            match fetch_open_meteo(&runtime.client(), location, cancellation).await {
                Ok(snapshot) => Ok(ticket.succeed(snapshot, current_time_millis(), Instant::now())),
                Err(error) if error.code == "cancelled" => Ok(ticket.cancel(current_time_millis())),
                Err(error) => Ok(ticket.fail(error.code, current_time_millis(), Instant::now())),
            }
        }
    }
}

#[tauri::command]
pub fn weather_cancel(
    runtime: State<'_, WeatherRuntime>,
    location: WeatherLocation,
) -> Result<bool, WeatherError> {
    location.validate()?;
    Ok(runtime.cancel_active(&location))
}

fn current_time_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}
