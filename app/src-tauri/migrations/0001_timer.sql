CREATE TABLE timer_state (
    singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
    phase TEXT NOT NULL CHECK (phase IN ('focus', 'break')),
    state TEXT NOT NULL CHECK (state IN ('idle', 'running', 'paused', 'completed')),
    duration_ms INTEGER NOT NULL CHECK (duration_ms > 0),
    remaining_ms INTEGER NOT NULL CHECK (remaining_ms >= 0),
    deadline_utc INTEGER,
    generation INTEGER NOT NULL CHECK (generation >= 0),
    completion_id TEXT,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    last_observed_utc INTEGER,
    clock_anomaly INTEGER NOT NULL DEFAULT 0 CHECK (clock_anomaly IN (0, 1))
);

CREATE TABLE timer_actions (
    action_id TEXT PRIMARY KEY NOT NULL,
    created_at INTEGER NOT NULL
);

INSERT INTO timer_state(
    singleton, phase, state, duration_ms, remaining_ms, deadline_utc,
    generation, completion_id, revision, last_observed_utc, clock_anomaly
) VALUES (1, 'focus', 'idle', 1500000, 1500000, NULL, 0, NULL, 0, NULL, 0);
