CREATE TABLE todo_items (
    id TEXT PRIMARY KEY NOT NULL,
    text TEXT NOT NULL,
    completed INTEGER NOT NULL CHECK (completed IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    priority_order INTEGER NOT NULL
);

CREATE INDEX todo_items_priority_idx
    ON todo_items(priority_order, created_at, id);

CREATE TABLE todo_actions (
    action_id TEXT PRIMARY KEY NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE todo_meta (
    singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
    revision INTEGER NOT NULL CHECK (revision >= 0)
);

INSERT INTO todo_meta(singleton, revision) VALUES (1, 0);
