package com.kronos.app.backend;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

/**
 * Banco SQLite do backend. Os nomes de tabelas e colunas são os mesmos que o
 * frontend usa nas consultas (services/api.ts).
 *
 * Tipos: datas ficam como texto "YYYY-MM-DD", horários em ISO-8601 (UTC) e
 * booleanos como 0/1 (declarados BOOLEAN para a API devolver true/false).
 */
public class Database extends SQLiteOpenHelper {

    private static final String NAME = "kronos.db";
    private static final int VERSION = 1;

    /** Valor padrão de created_at: agora, no mesmo formato do JavaScript */
    private static final String NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

    private static final String[] SCHEMA = {
        // ── Contas (só o backend acessa) ──
        "CREATE TABLE users (" +
            "id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, " +
            "salt TEXT NOT NULL, created_at TEXT DEFAULT " + NOW + ")",
        "CREATE TABLE auth_sessions (" +
            "token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT DEFAULT " + NOW + ")",

        // ── Perfil e squads ──
        "CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT, avatar_url TEXT)",
        "CREATE TABLE squads (" +
            "id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, invite_code TEXT UNIQUE, " +
            "is_personal BOOLEAN NOT NULL DEFAULT 0, created_by TEXT, created_at TEXT DEFAULT " + NOW + ")",
        "CREATE TABLE squad_members (" +
            "id TEXT PRIMARY KEY, squad_id TEXT NOT NULL, user_id TEXT NOT NULL, " +
            "role TEXT NOT NULL DEFAULT 'member', created_at TEXT DEFAULT " + NOW + ", " +
            "UNIQUE (squad_id, user_id))",

        // ── Treino ──
        "CREATE TABLE workout_days (" +
            "id TEXT PRIMARY KEY, squad_id TEXT NOT NULL, name TEXT NOT NULL, focus TEXT, " +
            "day_order INTEGER NOT NULL, created_at TEXT DEFAULT " + NOW + ")",
        "CREATE TABLE exercises (" +
            "id TEXT PRIMARY KEY, workout_day_id TEXT NOT NULL, name TEXT NOT NULL, " +
            "sets INTEGER NOT NULL DEFAULT 3, reps TEXT, rest TEXT, notes TEXT, " +
            "completed BOOLEAN NOT NULL DEFAULT 0, created_at TEXT DEFAULT " + NOW + ")",
        "CREATE TABLE exercise_progress (" +
            "id TEXT PRIMARY KEY, exercise_id TEXT NOT NULL, user_id TEXT NOT NULL, date TEXT NOT NULL, " +
            "completed BOOLEAN NOT NULL DEFAULT 0, skipped BOOLEAN NOT NULL DEFAULT 0, " +
            "created_at TEXT DEFAULT " + NOW + ", UNIQUE (exercise_id, user_id, date))",
        "CREATE TABLE set_logs (" +
            "id TEXT PRIMARY KEY, user_id TEXT NOT NULL, exercise_id TEXT NOT NULL, date TEXT NOT NULL, " +
            "set_index INTEGER NOT NULL, weight REAL, reps INTEGER, rpe INTEGER, " +
            "done BOOLEAN NOT NULL DEFAULT 0, updated_at TEXT, created_at TEXT DEFAULT " + NOW + ", " +
            "UNIQUE (user_id, exercise_id, date, set_index))",
        "CREATE TABLE workout_sessions (" +
            "id TEXT PRIMARY KEY, user_id TEXT NOT NULL, workout_day_id TEXT, date TEXT NOT NULL, " +
            "started_at TEXT DEFAULT " + NOW + ", ended_at TEXT, total_volume REAL)",
        "CREATE TABLE tracked_exercises (" +
            "id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT DEFAULT " + NOW + ")",
        "CREATE TABLE exercise_loads (" +
            "id TEXT PRIMARY KEY, tracked_exercise_id TEXT NOT NULL, user_id TEXT NOT NULL, " +
            "date TEXT NOT NULL, load_notes TEXT, created_at TEXT DEFAULT " + NOW + ")",

        // ── Dieta e corpo ──
        "CREATE TABLE water_intake (" +
            "id TEXT PRIMARY KEY, user_id TEXT NOT NULL, ml INTEGER NOT NULL, date TEXT NOT NULL, " +
            "created_at TEXT DEFAULT " + NOW + ")",
        "CREATE TABLE diet_settings (" +
            "user_id TEXT PRIMARY KEY, water_goal_ml INTEGER DEFAULT 2000, " +
            "calorie_goal INTEGER, protein_goal INTEGER)",
        "CREATE TABLE meal_slots (" +
            "id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, position INTEGER NOT NULL, " +
            "time_hint TEXT, kcal_goal REAL DEFAULT 0, protein_goal REAL DEFAULT 0, " +
            "carbs_goal REAL DEFAULT 0, fat_goal REAL DEFAULT 0, created_at TEXT DEFAULT " + NOW + ")",
        "CREATE TABLE meals (" +
            "id TEXT PRIMARY KEY, user_id TEXT NOT NULL, date TEXT NOT NULL, name TEXT NOT NULL, " +
            "calories REAL, protein REAL, carbs REAL, fat REAL, slot_id TEXT, " +
            "created_at TEXT DEFAULT " + NOW + ")",
        "CREATE TABLE favorite_meals (" +
            "id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, " +
            "calories REAL, protein REAL, carbs REAL, fat REAL, slot_id TEXT, " +
            "times_used INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT " + NOW + ")",
        "CREATE TABLE body_weight (" +
            "id TEXT PRIMARY KEY, user_id TEXT NOT NULL, date TEXT NOT NULL, weight REAL NOT NULL, " +
            "created_at TEXT DEFAULT " + NOW + ", UNIQUE (user_id, date))",
        "CREATE TABLE body_measurements (" +
            "id TEXT PRIMARY KEY, user_id TEXT NOT NULL, date TEXT NOT NULL, " +
            "chest REAL, waist REAL, hip REAL, arm REAL, thigh REAL, " +
            "created_at TEXT DEFAULT " + NOW + ", UNIQUE (user_id, date))",

        // ── Índices das consultas mais frequentes ──
        "CREATE INDEX idx_members_user ON squad_members (user_id)",
        "CREATE INDEX idx_days_squad ON workout_days (squad_id)",
        "CREATE INDEX idx_exercises_day ON exercises (workout_day_id)",
        "CREATE INDEX idx_progress_user_date ON exercise_progress (user_id, date)",
        "CREATE INDEX idx_set_logs_user_date ON set_logs (user_id, date)",
        "CREATE INDEX idx_water_user_date ON water_intake (user_id, date)",
        "CREATE INDEX idx_meals_user_date ON meals (user_id, date)",
    };

    public Database(Context context) {
        super(context, NAME, null, VERSION);
        // Leituras não esperam as escritas (várias requisições chegam juntas)
        setWriteAheadLoggingEnabled(true);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        for (String sql : SCHEMA) db.execSQL(sql);
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // Primeira versão: ainda não há migrações
    }
}
