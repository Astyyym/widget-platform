use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};

pub const DEFAULT_RETENTION_MS: u64 = 7 * 24 * 60 * 60 * 1_000;
pub const DEFAULT_MAX_UNPINNED_ENTRIES: usize = 200;
pub const DEFAULT_MAX_TOTAL_BYTES: usize = 10 * 1024 * 1024;
const MAX_SOURCE_APP_ID_CHARS: usize = 128;
const MAX_RESTORE_MARKERS: usize = 64;
const MAX_PAGE_SIZE: usize = 100;
static NEXT_HISTORY_INSTANCE_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClipboardPolicy {
    pub enabled: bool,
    pub retention_ms: u64,
    pub max_unpinned_entries: usize,
    pub max_total_bytes: usize,
}

impl Default for ClipboardPolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            retention_ms: DEFAULT_RETENTION_MS,
            max_unpinned_entries: DEFAULT_MAX_UNPINNED_ENTRIES,
            max_total_bytes: DEFAULT_MAX_TOTAL_BYTES,
        }
    }
}

impl ClipboardPolicy {
    pub fn validate(&self) -> Result<(), ClipboardPolicyError> {
        if self.retention_ms == 0 || self.max_unpinned_entries == 0 || self.max_total_bytes == 0 {
            return Err(ClipboardPolicyError::InvalidLimit);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClipboardPolicyError {
    InvalidLimit,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureCandidate {
    pub text: String,
    pub observed_at_ms: u64,
    pub source_app_id: Option<String>,
    pub exclude_from_history: bool,
    pub restore_marker: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardEntry {
    pub id: String,
    pub text: String,
    pub created_at_ms: u64,
    pub source_app_id: Option<String>,
    pub pinned: bool,
    pub byte_len: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExclusionReason {
    MarkedNoHistory,
    SelfRestore,
    EmptyText,
    UnsupportedText,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CaptureOutcome {
    Disabled,
    InvalidPolicy,
    Excluded {
        reason: ExclusionReason,
        evicted_ids: Vec<String>,
    },
    Duplicate {
        entry_id: String,
        evicted_ids: Vec<String>,
    },
    Inserted {
        entry_id: String,
        evicted_ids: Vec<String>,
    },
    CapacityExceeded {
        evicted_ids: Vec<String>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PinOutcome {
    Updated,
    ExpiredRemoved { entry_id: String },
    NotFound,
    InvalidPolicy,
    CapacityExceeded,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClearScope {
    Unpinned,
    All,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RestorePayload {
    pub text: String,
    pub marker: String,
}

#[derive(Clone)]
pub struct ClipboardHistory {
    entries: Vec<ClipboardEntry>,
    restore_markers: VecDeque<String>,
    next_id: u64,
    next_restore_marker_id: u64,
    latest_observed_at_ms: Option<u64>,
    instance_id: u64,
}

impl Default for ClipboardHistory {
    fn default() -> Self {
        Self {
            entries: Vec::new(),
            restore_markers: VecDeque::new(),
            next_id: 0,
            next_restore_marker_id: 0,
            latest_observed_at_ms: None,
            instance_id: NEXT_HISTORY_INSTANCE_ID.fetch_add(1, Ordering::Relaxed),
        }
    }
}

impl ClipboardHistory {
    pub fn new() -> Self {
        Self::default()
    }

    pub(crate) fn from_entries(entries: Vec<ClipboardEntry>, revision: u64) -> Option<Self> {
        let mut next_id = revision;
        for entry in &entries {
            if entry.text.is_empty()
                || entry.text.contains('\0')
                || entry.byte_len != entry.text.len()
                || minimize_source_app_id(entry.source_app_id.as_deref()) != entry.source_app_id
            {
                return None;
            }
            let id = entry.id.strip_prefix("clip-")?.parse::<u64>().ok()?;
            next_id = next_id.max(id);
        }
        let latest_observed_at_ms = entries.iter().map(|entry| entry.created_at_ms).max();
        Some(Self {
            entries,
            restore_markers: VecDeque::new(),
            next_id,
            next_restore_marker_id: 0,
            latest_observed_at_ms,
            instance_id: NEXT_HISTORY_INSTANCE_ID.fetch_add(1, Ordering::Relaxed),
        })
    }

    pub(crate) fn entry(&self, entry_id: &str) -> Option<ClipboardEntry> {
        self.entries
            .iter()
            .find(|entry| entry.id == entry_id)
            .cloned()
    }

    pub(crate) fn prune(&mut self, policy: &ClipboardPolicy, now_ms: u64) -> Vec<String> {
        self.remove_expired_for_access(policy, now_ms)
    }

    pub(crate) fn page_owned(&self, offset: usize, limit: usize) -> Vec<ClipboardEntry> {
        self.entries
            .iter()
            .skip(offset)
            .take(limit.min(MAX_PAGE_SIZE))
            .cloned()
            .collect()
    }

    pub(crate) fn len(&self) -> usize {
        self.entries.len()
    }

    pub(crate) fn all_entries(&self) -> &[ClipboardEntry] {
        &self.entries
    }

    pub fn entries(&mut self, policy: &ClipboardPolicy, now_ms: u64) -> &[ClipboardEntry] {
        self.remove_expired_for_access(policy, now_ms);
        &self.entries
    }

    pub fn capture(
        &mut self,
        policy: &ClipboardPolicy,
        candidate: CaptureCandidate,
    ) -> CaptureOutcome {
        if !policy.enabled {
            return CaptureOutcome::Disabled;
        }
        if policy.validate().is_err() {
            return CaptureOutcome::InvalidPolicy;
        }
        let retention_evicted_ids =
            self.remove_expired_for_access(policy, candidate.observed_at_ms);
        if candidate.exclude_from_history {
            return CaptureOutcome::Excluded {
                reason: ExclusionReason::MarkedNoHistory,
                evicted_ids: retention_evicted_ids,
            };
        }
        if let Some(marker) = candidate.restore_marker.as_deref() {
            if let Some(index) = self
                .restore_markers
                .iter()
                .position(|known| known == marker)
            {
                self.restore_markers.remove(index);
                return CaptureOutcome::Excluded {
                    reason: ExclusionReason::SelfRestore,
                    evicted_ids: retention_evicted_ids,
                };
            }
        }

        let text = normalize_text(&candidate.text);
        if text.is_empty() {
            return CaptureOutcome::Excluded {
                reason: ExclusionReason::EmptyText,
                evicted_ids: retention_evicted_ids,
            };
        }
        if text.contains('\0') {
            return CaptureOutcome::Excluded {
                reason: ExclusionReason::UnsupportedText,
                evicted_ids: retention_evicted_ids,
            };
        }
        let byte_len = text.len();
        if byte_len > policy.max_total_bytes {
            return CaptureOutcome::CapacityExceeded {
                evicted_ids: retention_evicted_ids,
            };
        }

        let mut next_entries = self.entries.clone();
        let mut evicted_ids = retention_evicted_ids.clone();

        if let Some(latest) = next_entries.first().filter(|entry| entry.text == text) {
            let entry_id = latest.id.clone();
            self.entries = next_entries;
            return CaptureOutcome::Duplicate {
                entry_id,
                evicted_ids,
            };
        }

        while unpinned_count(&next_entries) >= policy.max_unpinned_entries {
            if !evict_oldest_unpinned(&mut next_entries, &mut evicted_ids) {
                break;
            }
        }
        while total_bytes(&next_entries).saturating_add(byte_len) > policy.max_total_bytes {
            if !evict_oldest_unpinned(&mut next_entries, &mut evicted_ids) {
                return CaptureOutcome::CapacityExceeded {
                    evicted_ids: retention_evicted_ids,
                };
            }
        }

        self.next_id = self.next_id.saturating_add(1);
        let entry_id = format!("clip-{}", self.next_id);
        next_entries.insert(
            0,
            ClipboardEntry {
                id: entry_id.clone(),
                text,
                created_at_ms: candidate.observed_at_ms,
                source_app_id: minimize_source_app_id(candidate.source_app_id.as_deref()),
                pinned: false,
                byte_len,
            },
        );
        self.entries = next_entries;
        CaptureOutcome::Inserted {
            entry_id,
            evicted_ids,
        }
    }

    pub fn set_pinned(
        &mut self,
        policy: &ClipboardPolicy,
        now_ms: u64,
        entry_id: &str,
        pinned: bool,
    ) -> PinOutcome {
        if policy.validate().is_err() {
            if pinned {
                return PinOutcome::InvalidPolicy;
            }
            let Some(entry) = self.entries.iter_mut().find(|entry| entry.id == entry_id) else {
                return PinOutcome::NotFound;
            };
            entry.pinned = false;
            return PinOutcome::Updated;
        }

        let clock_rolled_back = self
            .latest_observed_at_ms
            .is_some_and(|latest| now_ms < latest);
        self.remove_expired_for_access(policy, now_ms);
        let Some(index) = self.entries.iter().position(|entry| entry.id == entry_id) else {
            return PinOutcome::NotFound;
        };
        if pinned {
            if total_bytes(&self.entries) > policy.max_total_bytes {
                return PinOutcome::CapacityExceeded;
            }
        } else {
            let entry = &self.entries[index];
            let expired = clock_rolled_back
                || now_ms < entry.created_at_ms
                || now_ms - entry.created_at_ms >= policy.retention_ms;
            if expired {
                let entry_id = self.entries.remove(index).id;
                return PinOutcome::ExpiredRemoved { entry_id };
            }
        }
        self.entries[index].pinned = pinned;
        PinOutcome::Updated
    }

    pub fn page(
        &mut self,
        policy: &ClipboardPolicy,
        now_ms: u64,
        offset: usize,
        limit: usize,
    ) -> Vec<&ClipboardEntry> {
        self.remove_expired_for_access(policy, now_ms);
        self.entries
            .iter()
            .skip(offset)
            .take(limit.min(MAX_PAGE_SIZE))
            .collect()
    }

    pub fn delete(&mut self, entry_id: &str) -> bool {
        let original_len = self.entries.len();
        self.entries.retain(|entry| entry.id != entry_id);
        self.entries.len() != original_len
    }

    pub fn clear(&mut self, scope: ClearScope) -> usize {
        let original_len = self.entries.len();
        match scope {
            ClearScope::Unpinned => self.entries.retain(|entry| entry.pinned),
            ClearScope::All => self.entries.clear(),
        }
        original_len - self.entries.len()
    }

    pub fn prepare_restore(
        &mut self,
        policy: &ClipboardPolicy,
        now_ms: u64,
        entry_id: &str,
        action_id: &str,
    ) -> Option<RestorePayload> {
        if !valid_restore_marker(action_id) {
            return None;
        }
        self.remove_expired_for_access(policy, now_ms);
        let text = self
            .entries
            .iter()
            .find(|entry| entry.id == entry_id)?
            .text
            .clone();
        if self.restore_markers.len() >= MAX_RESTORE_MARKERS {
            return None;
        }
        self.next_restore_marker_id = self.next_restore_marker_id.checked_add(1)?;
        let marker = format!(
            "widget-platform:{}:{}",
            self.instance_id, self.next_restore_marker_id
        );
        self.restore_markers.push_back(marker.clone());
        Some(RestorePayload { text, marker })
    }

    pub(crate) fn cancel_restore_marker(&mut self, marker: &str) {
        if let Some(index) = self
            .restore_markers
            .iter()
            .position(|known| known == marker)
        {
            self.restore_markers.remove(index);
        }
    }

    fn remove_expired_for_access(&mut self, policy: &ClipboardPolicy, now_ms: u64) -> Vec<String> {
        let mut evicted_ids = Vec::new();
        let clock_rolled_back = self
            .latest_observed_at_ms
            .is_some_and(|latest| now_ms < latest);

        if clock_rolled_back {
            self.latest_observed_at_ms = Some(now_ms);
            self.entries.retain(|entry| {
                if entry.pinned {
                    true
                } else {
                    evicted_ids.push(entry.id.clone());
                    false
                }
            });
        } else {
            self.latest_observed_at_ms = Some(now_ms);
            remove_expired(
                &mut self.entries,
                now_ms,
                policy.retention_ms,
                &mut evicted_ids,
            );
        }
        evicted_ids
    }
}

fn normalize_text(value: &str) -> String {
    value.replace("\r\n", "\n").replace('\r', "\n")
}

fn minimize_source_app_id(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    let looks_like_executable_basename = value.to_ascii_lowercase().ends_with(".exe");
    let looks_like_aumid = value
        .split_once('!')
        .is_some_and(|(package, app)| !package.is_empty() && !app.is_empty() && !app.contains('!'));
    if value.is_empty()
        || value.chars().count() > MAX_SOURCE_APP_ID_CHARS
        || value.contains(['\\', '/', ':'])
        || (!looks_like_executable_basename && !looks_like_aumid)
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._-!".contains(character))
    {
        return None;
    }
    Some(value.to_owned())
}

fn valid_restore_marker(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._:-".contains(character))
}

fn remove_expired(
    entries: &mut Vec<ClipboardEntry>,
    now_ms: u64,
    retention_ms: u64,
    evicted_ids: &mut Vec<String>,
) {
    entries.retain(|entry| {
        let expired = !entry.pinned
            && now_ms >= entry.created_at_ms
            && now_ms - entry.created_at_ms >= retention_ms;
        if expired {
            evicted_ids.push(entry.id.clone());
        }
        !expired
    });
}

fn unpinned_count(entries: &[ClipboardEntry]) -> usize {
    entries.iter().filter(|entry| !entry.pinned).count()
}

fn total_bytes(entries: &[ClipboardEntry]) -> usize {
    entries
        .iter()
        .fold(0usize, |total, entry| total.saturating_add(entry.byte_len))
}

fn evict_oldest_unpinned(entries: &mut Vec<ClipboardEntry>, evicted_ids: &mut Vec<String>) -> bool {
    let Some(index) = entries.iter().rposition(|entry| !entry.pinned) else {
        return false;
    };
    let removed = entries.remove(index);
    evicted_ids.push(removed.id);
    true
}
