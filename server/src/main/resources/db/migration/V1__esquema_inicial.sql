-- Esquema do Kronos no PostgreSQL. Tabelas e colunas têm os mesmos nomes do
-- SQLite do app (android/.../backend/Database.java), porque a interface usa
-- esses nomes nas consultas.
--
-- created_at usa clock_timestamp() em vez de now(): now() devolve a hora do
-- início da transação, então várias linhas gravadas juntas ficariam com o
-- mesmo horário e a ordenação por created_at deixaria de ser confiável.

-- ── Contas (só o servidor acessa) ──────────────────────────────────────────
CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt          TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Guarda só o hash do token: quem ler o banco não consegue usar as sessões
CREATE TABLE auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- ── Perfil e squads ────────────────────────────────────────────────────────
CREATE TABLE profiles (
    id         TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    name       TEXT,
    avatar_url TEXT
);

CREATE TABLE squads (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    icon        TEXT,
    invite_code TEXT UNIQUE,
    is_personal BOOLEAN NOT NULL DEFAULT FALSE,
    created_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE squad_members (
    id         TEXT PRIMARY KEY,
    squad_id   TEXT NOT NULL REFERENCES squads (id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (squad_id, user_id)
);

-- ── Treino ─────────────────────────────────────────────────────────────────
CREATE TABLE workout_days (
    id         TEXT PRIMARY KEY,
    squad_id   TEXT NOT NULL REFERENCES squads (id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    focus      TEXT,
    day_order  INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE exercises (
    id             TEXT PRIMARY KEY,
    workout_day_id TEXT NOT NULL REFERENCES workout_days (id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    sets           INTEGER NOT NULL DEFAULT 3,
    reps           TEXT,
    rest           TEXT,
    notes          TEXT,
    completed      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE exercise_progress (
    id          TEXT PRIMARY KEY,
    exercise_id TEXT NOT NULL REFERENCES exercises (id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    date        DATE NOT NULL,
    completed   BOOLEAN NOT NULL DEFAULT FALSE,
    skipped     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (exercise_id, user_id, date)
);

CREATE TABLE set_logs (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    exercise_id TEXT NOT NULL REFERENCES exercises (id) ON DELETE CASCADE,
    date        DATE NOT NULL,
    set_index   INTEGER NOT NULL,
    weight      DOUBLE PRECISION,
    reps        INTEGER,
    rpe         INTEGER CHECK (rpe BETWEEN 1 AND 10),
    done        BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (user_id, exercise_id, date, set_index)
);

CREATE TABLE workout_sessions (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    workout_day_id TEXT REFERENCES workout_days (id) ON DELETE SET NULL,
    date           DATE NOT NULL,
    started_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    ended_at       TIMESTAMPTZ,
    total_volume   DOUBLE PRECISION
);

CREATE TABLE tracked_exercises (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE exercise_loads (
    id                  TEXT PRIMARY KEY,
    tracked_exercise_id TEXT NOT NULL REFERENCES tracked_exercises (id) ON DELETE CASCADE,
    user_id             TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    date                DATE NOT NULL,
    load_notes          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- ── Dieta e corpo ──────────────────────────────────────────────────────────
CREATE TABLE water_intake (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    ml         INTEGER NOT NULL,
    date       DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE diet_settings (
    user_id       TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    water_goal_ml INTEGER DEFAULT 2000,
    calorie_goal  INTEGER,
    protein_goal  INTEGER
);

CREATE TABLE meal_slots (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    position     INTEGER NOT NULL,
    time_hint    TEXT,
    kcal_goal    DOUBLE PRECISION DEFAULT 0,
    protein_goal DOUBLE PRECISION DEFAULT 0,
    carbs_goal   DOUBLE PRECISION DEFAULT 0,
    fat_goal     DOUBLE PRECISION DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE meals (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    date       DATE NOT NULL,
    name       TEXT NOT NULL,
    calories   DOUBLE PRECISION,
    protein    DOUBLE PRECISION,
    carbs      DOUBLE PRECISION,
    fat        DOUBLE PRECISION,
    slot_id    TEXT REFERENCES meal_slots (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE favorite_meals (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    calories   DOUBLE PRECISION,
    protein    DOUBLE PRECISION,
    carbs      DOUBLE PRECISION,
    fat        DOUBLE PRECISION,
    slot_id    TEXT REFERENCES meal_slots (id) ON DELETE SET NULL,
    times_used INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE body_weight (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    date       DATE NOT NULL,
    weight     DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (user_id, date)
);

CREATE TABLE body_measurements (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    date       DATE NOT NULL,
    chest      DOUBLE PRECISION,
    waist      DOUBLE PRECISION,
    hip        DOUBLE PRECISION,
    arm        DOUBLE PRECISION,
    thigh      DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (user_id, date)
);

-- ── Imagens (foto de perfil e de squad) ────────────────────────────────────
-- Ficam no próprio banco: hospedagens gratuitas apagam o disco a cada deploy.
CREATE TABLE files (
    bucket       TEXT NOT NULL,
    path         TEXT NOT NULL,
    content_type TEXT NOT NULL,
    data         BYTEA NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (bucket, path)
);

-- ── Índices das consultas mais frequentes ──────────────────────────────────
CREATE INDEX idx_sessions_user ON auth_sessions (user_id);
CREATE INDEX idx_members_user ON squad_members (user_id);
CREATE INDEX idx_days_squad ON workout_days (squad_id);
CREATE INDEX idx_exercises_day ON exercises (workout_day_id);
CREATE INDEX idx_progress_user_date ON exercise_progress (user_id, date);
CREATE INDEX idx_set_logs_user_date ON set_logs (user_id, date);
CREATE INDEX idx_water_user_date ON water_intake (user_id, date);
CREATE INDEX idx_meals_user_date ON meals (user_id, date);
