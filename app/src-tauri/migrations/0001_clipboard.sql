CREATE TABLE clipboard_entries (
    id TEXT PRIMARY KEY NOT NULL,
    protected_version INTEGER NOT NULL CHECK (protected_version > 0 AND protected_version <= 255),
    ciphertext BLOB NOT NULL CHECK (length(ciphertext) > 0),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    source_app_id TEXT,
    pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
    byte_len INTEGER NOT NULL CHECK (byte_len > 0)
);

CREATE INDEX clipboard_entries_created_at_idx
    ON clipboard_entries(created_at_ms DESC, id DESC);

CREATE TABLE clipboard_meta (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    revision INTEGER NOT NULL CHECK (revision >= 0)
);

INSERT INTO clipboard_meta(singleton, revision) VALUES (1, 0);
