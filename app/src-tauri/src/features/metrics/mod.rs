mod model;

#[cfg(target_os = "windows")]
mod windows;

#[cfg(not(target_os = "windows"))]
mod unsupported;

pub(crate) mod commands;

pub use model::MetricsSnapshot;

#[cfg(target_os = "windows")]
pub use windows::MetricsState;

#[cfg(not(target_os = "windows"))]
pub use unsupported::MetricsState;

#[cfg(test)]
mod tests;
