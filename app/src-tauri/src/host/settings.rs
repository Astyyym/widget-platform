use crate::features::weather::model::WeatherLocation;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
#[cfg(windows)]
use std::os::windows::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const SETTINGS_FILE: &str = "settings.json";
const CONTENT_IDS: &[&str] = &[
    "todo",
    "focus",
    "cpu",
    "gpu",
    "memory",
    "media",
    "codex",
    "weather",
    "clipboard",
];
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static SETTINGS_WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn default_rows() -> u8 {
    1
}

fn default_dock_opacity() -> u8 {
    100
}

fn default_dock_material() -> DockMaterial {
    DockMaterial::Solid
}

fn default_dock_blur() -> u8 {
    16
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppSettings {
    pub schema_version: u8,
    pub enabled_content_ids: Vec<String>,
    pub edge: DockEdge,
    pub edge_offset: f64,
    pub long_side: u16,
    pub thickness: u16,
    pub icon_size: u8,
    #[serde(default = "default_dock_opacity")]
    pub dock_opacity: u8,
    #[serde(default = "default_dock_material")]
    pub dock_material: DockMaterial,
    #[serde(default = "default_dock_blur")]
    pub dock_blur: u8,
    #[serde(default = "default_rows")]
    pub rows: u8,
    pub visibility: VisibilityMode,
    #[serde(default)]
    pub weather: Option<WeatherLocation>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: 5,
            enabled_content_ids: CONTENT_IDS
                .iter()
                .filter(|id| **id != "clipboard")
                .map(|id| (*id).to_string())
                .collect(),
            edge: DockEdge::Top,
            edge_offset: 0.5,
            long_side: 260,
            thickness: 80,
            icon_size: 46,
            dock_opacity: 100,
            dock_material: DockMaterial::Solid,
            dock_blur: 16,
            rows: 1,
            visibility: VisibilityMode::Always,
            weather: None,
        }
    }
}

impl AppSettings {
    fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1
            && self.schema_version != 2
            && self.schema_version != 3
            && self.schema_version != 4
            && self.schema_version != 5
        {
            return Err("设置版本不受支持。".into());
        }
        let mut seen = HashSet::new();
        for id in &self.enabled_content_ids {
            if !CONTENT_IDS.contains(&id.as_str()) || !seen.insert(id) {
                return Err("模块列表包含未知项或重复项。".into());
            }
        }
        if !self.edge_offset.is_finite() || !(0.0..=1.0).contains(&self.edge_offset) {
            return Err("停靠位置必须在边缘范围内。".into());
        }
        if !(96..=720).contains(&self.long_side) {
            return Err("卡片长边超出支持范围。".into());
        }
        if !(40..=240).contains(&self.thickness) {
            return Err("卡片厚度超出支持范围。".into());
        }
        if !(20..=52).contains(&self.icon_size) {
            return Err("图标直径超出支持范围。".into());
        }
        if !(1..=4).contains(&self.rows) {
            return Err("模块排数必须在 1 到 4 之间。".into());
        }
        if self.dock_opacity > 100 {
            return Err("导航条透明度必须在 0–100 之间。".into());
        }
        if self.dock_blur > 32 {
            return Err("导航条模糊强度必须在 0–32 之间。".into());
        }
        if let Some(weather) = &self.weather {
            weather
                .validate()
                .map_err(|error| error.message.to_string())?;
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DockEdge {
    Top,
    Right,
    Bottom,
    Left,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VisibilityMode {
    Always,
    Hidden,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DockMaterial {
    Solid,
    Translucent,
    Glass,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsLoad {
    pub settings: AppSettings,
    pub notice: Option<String>,
}

fn settings_path(directory: &Path) -> PathBuf {
    directory.join(SETTINGS_FILE)
}

fn migrate_settings(mut settings: AppSettings) -> (AppSettings, Option<String>) {
    let mut added_modules = Vec::new();
    let removed_temperature = settings
        .enabled_content_ids
        .iter()
        .any(|id| id == "temperature");
    settings
        .enabled_content_ids
        .retain(|id| id != "temperature");
    if settings.schema_version == 1 {
        settings.schema_version = 2;
        if !settings.enabled_content_ids.iter().any(|id| id == "media") {
            settings.enabled_content_ids.push("media".into());
            added_modules.push("媒体");
        }
    }
    if settings.schema_version == 2 {
        settings.schema_version = 3;
        if !settings.enabled_content_ids.iter().any(|id| id == "codex") {
            settings.enabled_content_ids.push("codex".into());
            added_modules.push("Codex额度");
        }
    }
    if settings.schema_version == 3 {
        settings.schema_version = 4;
        settings.weather = None;
        if !settings
            .enabled_content_ids
            .iter()
            .any(|id| id == "weather")
        {
            settings.enabled_content_ids.push("weather".into());
            added_modules.push("天气");
        }
    }
    if settings.schema_version == 4 {
        settings.schema_version = 5;
        if settings
            .enabled_content_ids
            .iter()
            .any(|id| id == "clipboard")
        {
            settings.enabled_content_ids.retain(|id| id != "clipboard");
            added_modules.push("剪贴板已关闭；要继续记录，请在设置中重新显示模块");
        }
    }
    let notice = if removed_temperature || !added_modules.is_empty() {
        let mut changes = added_modules;
        if removed_temperature {
            changes.push("已移除硬件温度模块");
        }
        Some(format!(
            "设置已迁移：{}；保存设置后会保留此变更。",
            changes.join("、")
        ))
    } else {
        None
    };
    (settings, notice)
}

fn diagnostic_copy_path(directory: &Path) -> PathBuf {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let process_id = std::process::id();
    let base = format!("settings.corrupt-{millis}-{process_id}");
    let mut candidate = directory.join(format!("{base}.json"));
    let mut sequence = 0u32;
    while candidate.exists() {
        sequence = sequence.saturating_add(1);
        candidate = directory.join(format!("{base}-{sequence}.json"));
    }
    candidate
}

fn load_from_directory(directory: &Path) -> Result<SettingsLoad, String> {
    let path = settings_path(directory);
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(SettingsLoad {
                settings: AppSettings::default(),
                notice: None,
            });
        }
        Err(_) => return Err("设置读取失败，原有文件已保留。".into()),
    };

    let parsed = serde_json::from_slice::<AppSettings>(&bytes)
        .map_err(|_| "设置文件格式无法读取。".to_string())
        .and_then(|settings| {
            let (settings, notice) = migrate_settings(settings);
            settings.validate()?;
            Ok((settings, notice))
        });

    match parsed {
        Ok((settings, notice)) => Ok(SettingsLoad { settings, notice }),
        Err(_) => {
            let diagnostic = diagnostic_copy_path(directory);
            fs::copy(&path, &diagnostic)
                .map_err(|_| "设置损坏，且无法创建诊断副本；原文件已保留。".to_string())?;
            Ok(SettingsLoad {
                settings: AppSettings::default(),
                notice: Some("设置文件损坏；已保留诊断副本并载入默认设置。".into()),
            })
        }
    }
}

fn write_atomic_with<F>(path: &Path, bytes: &[u8], replace: F) -> io::Result<()>
where
    F: FnOnce(&Path, &Path) -> io::Result<()>,
{
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "settings path has no parent")
    })?;
    fs::create_dir_all(parent)?;
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = parent.join(format!(
        ".settings-{}-{timestamp}-{sequence}.tmp",
        std::process::id()
    ));

    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        replace(&temporary, path).map_err(|error| {
            let os_code = error
                .raw_os_error()
                .map(|code| code.to_string())
                .unwrap_or_else(|| "无".into());
            io::Error::new(
                error.kind(),
                format!("原子替换设置文件失败，底层系统错误码：{os_code}。"),
            )
        })
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn save_to_directory(directory: &Path, settings: &AppSettings) -> Result<(), String> {
    settings.validate()?;
    if settings.schema_version != 5 {
        return Err("只能保存当前版本的设置。".into());
    }
    let bytes = serde_json::to_vec_pretty(settings).map_err(|_| "设置无法序列化。".to_string())?;
    let path = settings_path(directory);
    write_atomic_with(&path, &bytes, |temporary, target| {
        fs::rename(temporary, target)
    })
    .map_err(|error| {
        let os_code = error
            .raw_os_error()
            .map(|code| code.to_string())
            .unwrap_or_else(|| "无".into());
        format!(
            "设置保存失败；原有设置仍保留。原因：{:?}，系统错误码：{}；{} 请检查磁盘或文件权限后重试。",
            error.kind(),
            os_code,
            error
        )
    })
}

fn app_settings_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let app_local_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "无法定位应用的本机数据目录。".to_string())?;

    #[cfg(windows)]
    {
        const FILE_ATTRIBUTE_ENCRYPTED: u32 = 0x4000;
        let profile = std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .ok_or_else(|| "无法定位当前用户的本机设置目录。".to_string())?;
        let app_directory_name = app_local_data_dir
            .file_name()
            .ok_or_else(|| "无法确定应用设置目录名称。".to_string())?;
        let directory = profile.join(".widget-platform").join(app_directory_name);
        std::fs::create_dir_all(&directory)
            .map_err(|_| "无法创建应用的本机设置目录。".to_string())?;
        let metadata = std::fs::metadata(&directory)
            .map_err(|_| "无法检查应用的本机设置目录。".to_string())?;
        if metadata.file_attributes() & FILE_ATTRIBUTE_ENCRYPTED != 0 {
            return Err("应用设置目录启用了 Windows EFS；为保护原子保存，设置尚未写入。".into());
        }
        Ok(directory)
    }

    #[cfg(not(windows))]
    {
        Ok(app_local_data_dir)
    }
}

#[tauri::command]
pub fn settings_load(app: AppHandle) -> Result<SettingsLoad, String> {
    let directory = app_settings_directory(&app)?;
    load_from_directory(&directory)
}

#[tauri::command]
pub fn settings_save(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let lock = SETTINGS_WRITE_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "设置写入队列不可用。".to_string())?;
    let directory = app_settings_directory(&app)?;
    save_to_directory(&directory, &settings)
}

#[cfg(test)]
mod tests {
    use super::{
        load_from_directory, save_to_directory, write_atomic_with, AppSettings, VisibilityMode,
    };
    use crate::features::weather::model::{TemperatureUnit, WeatherLocation};
    use std::fs;
    use std::io;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn test_directory() -> PathBuf {
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let directory = std::env::temp_dir().join(format!(
            "widget-platform-settings-test-{}-{sequence}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).expect("test directory should be created");
        directory
    }

    #[test]
    fn missing_file_uses_defaults_without_writing() {
        let directory = test_directory();
        let loaded = load_from_directory(&directory).expect("missing file should use defaults");
        assert_eq!(loaded.settings, AppSettings::default());
        assert_eq!(loaded.settings.schema_version, 5);
        assert!(loaded
            .settings
            .enabled_content_ids
            .iter()
            .any(|id| id == "weather"));
        assert!(loaded.settings.weather.is_none());
        assert!(!loaded
            .settings
            .enabled_content_ids
            .iter()
            .any(|id| id == "clipboard"));
        assert!(loaded.notice.is_none());
        assert!(!directory.join("settings.json").exists());
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn dock_opacity_defaults_for_legacy_and_round_trips() {
        let mut legacy = serde_json::to_value(AppSettings::default()).unwrap();
        legacy.as_object_mut().unwrap().remove("dockOpacity");
        let settings: AppSettings = serde_json::from_value(legacy).unwrap();
        assert_eq!(serde_json::to_value(&settings).unwrap()["dockOpacity"], 100);
        assert_eq!(
            serde_json::to_value(&settings).unwrap()["dockMaterial"],
            "solid"
        );
        assert_eq!(serde_json::to_value(&settings).unwrap()["dockBlur"], 16);
        let mut value = serde_json::to_value(settings).unwrap();
        value["dockOpacity"] = serde_json::json!(45);
        value["dockMaterial"] = serde_json::json!("glass");
        value["dockBlur"] = serde_json::json!(24);
        let settings: AppSettings = serde_json::from_value(value.clone()).unwrap();
        let directory = test_directory();
        save_to_directory(&directory, &settings).unwrap();
        assert_eq!(load_from_directory(&directory).unwrap().settings, settings);
        value["dockOpacity"] = serde_json::json!(101);
        let invalid: AppSettings = serde_json::from_value(value).unwrap();
        assert!(invalid.validate().is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn compact_twenty_pixel_geometry_round_trips() {
        let directory = test_directory();
        let mut settings = AppSettings::default();
        settings.icon_size = 20;
        settings.long_side = 96;
        settings.thickness = 40;
        save_to_directory(&directory, &settings).expect("compact settings should save");
        assert_eq!(load_from_directory(&directory).unwrap().settings, settings);
        settings.icon_size = 19;
        assert!(settings.validate().is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn settings_round_trip_through_the_injected_directory() {
        let directory = test_directory();
        let mut settings = AppSettings::default();
        settings.enabled_content_ids = vec!["memory".into(), "todo".into()];
        settings.edge = super::DockEdge::Right;
        settings.edge_offset = 0.25;
        settings.long_side = 420;
        settings.thickness = 96;
        settings.icon_size = 40;
        settings.rows = 2;
        settings.visibility = VisibilityMode::Hidden;
        settings.weather = Some(WeatherLocation {
            name: "杭州".into(),
            latitude: 30.2741,
            longitude: 120.1551,
            timezone: "Asia/Shanghai".into(),
            temperature_unit: TemperatureUnit::Celsius,
        });
        save_to_directory(&directory, &settings).expect("settings should save");
        let loaded = load_from_directory(&directory).expect("settings should load");
        assert_eq!(loaded.settings, settings);
        assert!(loaded.notice.is_none());
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn legacy_clipboard_is_disabled_on_load_without_rewriting_the_source_file() {
        let directory = test_directory();
        let original = directory.join("settings.json");
        let mut legacy = AppSettings::default();
        legacy.schema_version = 4;
        legacy.enabled_content_ids = vec!["memory".into(), "clipboard".into(), "todo".into()];
        let bytes = serde_json::to_vec_pretty(&legacy).expect("legacy settings serialize");
        fs::write(&original, &bytes).expect("legacy settings write");

        let loaded = load_from_directory(&directory).expect("legacy settings load");
        assert_eq!(loaded.settings.schema_version, 5);
        assert_eq!(loaded.settings.enabled_content_ids, vec!["memory", "todo"]);
        assert!(loaded.notice.unwrap_or_default().contains("剪贴板"));
        assert_eq!(
            fs::read(&original).expect("original settings remain"),
            bytes
        );

        let mut opted_in = loaded.settings;
        opted_in.enabled_content_ids.push("clipboard".into());
        save_to_directory(&directory, &opted_in).expect("explicit opt-in saves current schema");
        let reloaded = load_from_directory(&directory).expect("saved opt-in reloads");
        assert_eq!(
            reloaded.settings.enabled_content_ids,
            vec!["memory", "todo", "clipboard"]
        );
        assert!(reloaded.notice.is_none());
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn schema_one_settings_migrate_in_memory_without_rewriting_the_source_file() {
        let directory = test_directory();
        let original = directory.join("settings.json");
        let mut legacy = AppSettings::default();
        legacy.schema_version = 1;
        legacy.enabled_content_ids = vec!["memory".into(), "todo".into()];
        legacy.edge = super::DockEdge::Right;
        let bytes = serde_json::to_vec_pretty(&legacy).expect("legacy settings should serialize");
        fs::write(&original, &bytes).expect("legacy settings should be written");

        let loaded = load_from_directory(&directory).expect("legacy settings should migrate");
        assert_eq!(loaded.settings.schema_version, 5);
        assert_eq!(
            loaded.settings.enabled_content_ids,
            vec!["memory", "todo", "media", "codex", "weather"]
        );
        assert!(loaded.settings.weather.is_none());
        assert_eq!(loaded.settings.edge, super::DockEdge::Right);
        assert!(loaded.notice.is_some());
        assert_eq!(
            fs::read(&original).expect("legacy file should remain"),
            bytes
        );

        save_to_directory(&directory, &loaded.settings).expect("migrated settings should save");
        let saved = load_from_directory(&directory).expect("saved settings should reload");
        assert_eq!(saved.settings, loaded.settings);
        assert!(saved.notice.is_none());
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn retired_temperature_module_is_removed_before_validating_legacy_settings() {
        let directory = test_directory();
        let mut legacy = AppSettings::default();
        legacy.enabled_content_ids = vec!["cpu".into(), "temperature".into(), "gpu".into()];
        fs::write(
            directory.join("settings.json"),
            serde_json::to_vec_pretty(&legacy).expect("legacy settings should serialize"),
        )
        .expect("legacy settings should be written");

        let loaded = load_from_directory(&directory).expect("legacy settings should load");
        assert_eq!(loaded.settings.enabled_content_ids, vec!["cpu", "gpu"]);
        assert!(loaded.notice.unwrap_or_default().contains("硬件温度"));
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn schema_two_settings_migrate_by_appending_codex_without_reordering() {
        let directory = test_directory();
        let original = directory.join("settings.json");
        let mut legacy = AppSettings::default();
        legacy.schema_version = 2;
        legacy.enabled_content_ids = vec!["memory".into(), "todo".into()];
        let bytes = serde_json::to_vec_pretty(&legacy).expect("legacy settings should serialize");
        fs::write(&original, &bytes).expect("legacy settings should be written");

        let loaded = load_from_directory(&directory).expect("version two settings should migrate");
        assert_eq!(loaded.settings.schema_version, 5);
        assert_eq!(
            loaded.settings.enabled_content_ids,
            vec!["memory", "todo", "codex", "weather"]
        );
        assert!(loaded.notice.is_some());
        assert_eq!(
            fs::read(&original).expect("legacy file should remain"),
            bytes
        );

        save_to_directory(&directory, &loaded.settings).expect("migrated settings should save");
        let saved = load_from_directory(&directory).expect("saved settings should reload");
        assert_eq!(saved.settings, loaded.settings);
        assert!(saved.notice.is_none());
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn schema_three_settings_append_weather_without_reordering() {
        let directory = test_directory();
        let original = directory.join("settings.json");
        let mut legacy = AppSettings::default();
        legacy.schema_version = 3;
        legacy.enabled_content_ids = vec!["memory".into(), "todo".into()];
        legacy.weather = None;
        let bytes = serde_json::to_vec_pretty(&legacy).expect("legacy settings should serialize");
        fs::write(&original, &bytes).expect("legacy settings should be written");

        let loaded =
            load_from_directory(&directory).expect("version three settings should migrate");
        assert_eq!(loaded.settings.schema_version, 5);
        assert_eq!(
            loaded.settings.enabled_content_ids,
            vec!["memory", "todo", "weather"]
        );
        assert!(loaded.settings.weather.is_none());
        assert!(loaded.notice.is_some());
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn corrupt_file_keeps_original_and_creates_diagnostic_copy() {
        let directory = test_directory();
        let original = directory.join("settings.json");
        let corrupt = b"{ this is not valid settings }";
        fs::write(&original, corrupt).expect("corrupt fixture should be written");

        let loaded = load_from_directory(&directory).expect("corrupt file should recover");
        assert_eq!(loaded.settings, AppSettings::default());
        assert!(loaded.notice.is_some());
        assert_eq!(
            fs::read(&original).expect("original should remain"),
            corrupt
        );
        let diagnostics = fs::read_dir(&directory)
            .expect("diagnostic directory should exist")
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .is_some_and(|name| name.to_string_lossy().starts_with("settings.corrupt-"))
            })
            .collect::<Vec<_>>();
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(
            fs::read(&diagnostics[0]).expect("diagnostic copy should exist"),
            corrupt
        );
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn atomic_replace_failure_preserves_the_previous_file() {
        let directory = test_directory();
        let target = directory.join("settings.json");
        fs::write(&target, b"previous settings").expect("previous settings should exist");
        let result = write_atomic_with(&target, b"new settings", |_, _| {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "simulated replacement failure",
            ))
        });
        assert!(result.is_err());
        assert_eq!(
            fs::read(&target).expect("old settings should remain"),
            b"previous settings"
        );
        assert_eq!(
            fs::read_dir(&directory)
                .expect("directory should be readable")
                .filter_map(Result::ok)
                .count(),
            1,
            "temporary file should be removed after a failed replacement"
        );
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn successful_atomic_replace_replaces_existing_file() {
        let directory = test_directory();
        let target = directory.join("settings.json");
        fs::write(&target, b"previous settings").expect("previous settings should exist");
        write_atomic_with(&target, b"new settings", |temporary, destination| {
            fs::rename(temporary, destination)
        })
        .expect("same-directory rename should replace the existing settings file");
        assert_eq!(
            fs::read(&target).expect("new settings should exist"),
            b"new settings"
        );
        assert_eq!(
            fs::read_dir(&directory)
                .expect("directory should be readable")
                .count(),
            1
        );
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn invalid_settings_are_rejected_before_replacing_existing_data() {
        let directory = test_directory();
        let target = directory.join("settings.json");
        fs::write(&target, b"previous settings").expect("previous settings should exist");
        let mut invalid = AppSettings::default();
        invalid.enabled_content_ids = vec!["todo".into(), "unknown".into()];
        assert!(save_to_directory(&directory, &invalid).is_err());
        assert_eq!(
            fs::read(&target).expect("old settings should remain"),
            b"previous settings"
        );
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn old_settings_without_rows_default_to_one_and_invalid_rows_preserve_data() {
        let directory = test_directory();
        let mut value = serde_json::to_value(AppSettings::default()).unwrap();
        value.as_object_mut().unwrap().remove("rows");
        let original = serde_json::to_vec(&value).unwrap();
        fs::write(directory.join("settings.json"), &original).unwrap();
        let loaded = load_from_directory(&directory).unwrap();
        assert_eq!(loaded.settings.rows, 1);
        assert_eq!(fs::read(directory.join("settings.json")).unwrap(), original);
        let mut invalid = loaded.settings;
        invalid.rows = 0;
        assert!(save_to_directory(&directory, &invalid).is_err());
        assert_eq!(fs::read(directory.join("settings.json")).unwrap(), original);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn clipboard_is_a_valid_content_id() {
        let mut settings = AppSettings::default();
        settings.enabled_content_ids = vec!["clipboard".into()];
        assert!(settings.validate().is_ok());
    }

    #[test]
    fn invalid_weather_location_is_rejected_before_replacing_existing_data() {
        let directory = test_directory();
        let target = directory.join("settings.json");
        fs::write(&target, b"previous settings").expect("previous settings should exist");
        let mut invalid = AppSettings::default();
        invalid.weather = Some(WeatherLocation {
            name: "自动定位".into(),
            latitude: 0.0,
            longitude: 0.0,
            timezone: "auto".into(),
            temperature_unit: TemperatureUnit::Celsius,
        });
        assert!(save_to_directory(&directory, &invalid).is_err());
        assert_eq!(
            fs::read(&target).expect("old settings should remain"),
            b"previous settings"
        );
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }
}
