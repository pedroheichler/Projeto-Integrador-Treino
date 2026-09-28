package com.kronos.app.backend;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Funções do servidor (RPCs), chamadas pelo frontend em /api/rpc/{nome}.
 * Cada uma faz várias operações de uma vez, dentro de uma transação.
 */
public class RpcService {

    private static final String[] WEEK_DAYS = {
        "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"
    };

    /** Rotina alimentar criada na primeira vez que o usuário abre a Dieta */
    private static final String[][] DEFAULT_SLOTS = {
        {"Café da manhã", "07:00"},
        {"Lanche da manhã", "10:00"},
        {"Almoço", "12:30"},
        {"Lanche da tarde", "16:00"},
        {"Jantar", "19:30"},
        {"Ceia", "22:00"},
    };

    private static final String SLOT_COLUMNS =
        "id, name, position, time_hint, kcal_goal, protein_goal, carbs_goal, fat_goal";
    private static final String MEAL_COLUMNS = "id, name, calories, protein, carbs, fat, slot_id";

    private final Database database;
    private final SecureRandom random = new SecureRandom();

    public RpcService(Database database) {
        this.database = database;
    }

    public Object call(String name, String userId, JSONObject args) throws ApiException, JSONException {
        switch (name) {
            case "create_squad":
                return createSquad(userId, args.optString("p_name", "Meu Treino"), args.optBoolean("p_personal"));
            case "join_squad_by_code":
                return joinSquadByCode(userId, args.optString("p_code"));
            case "finish_workout_session":
                return finishWorkoutSession(userId, args.optString("p_session_id"));
            case "exercise_personal_records":
                return query(
                    "SELECT exercise_id, MAX(weight) AS best_weight FROM set_logs " +
                    "WHERE user_id = ? AND weight IS NOT NULL GROUP BY exercise_id", userId);
            case "ensure_meal_routine":
                return ensureMealRoutine(userId);
            case "save_meal_routine":
                return saveMealRoutine(userId, args.optJSONArray("p_slots"));
            case "increment_favorite_use":
                write(db -> db.execSQL(
                    "UPDATE favorite_meals SET times_used = times_used + 1 WHERE id = ? AND user_id = ?",
                    new Object[]{args.optString("p_id"), userId}));
                return JSONObject.NULL;
            case "copy_meals_from":
                return copyMealsFrom(userId, args.optString("p_from"), args.optString("p_to"));
            case "diet_daily_totals":
                return query(
                    "SELECT date, COALESCE(SUM(calories), 0) AS kcal, COALESCE(SUM(protein), 0) AS protein " +
                    "FROM meals WHERE user_id = ? AND date BETWEEN ? AND ? GROUP BY date ORDER BY date",
                    userId, args.optString("p_from"), args.optString("p_to"));
            default:
                throw new ApiException(404, "Função não encontrada: " + name);
        }
    }

    // ── Squads ────────────────────────────────────────────────────────────

    /** Cria o squad (ou o espaço pessoal) com o criador como admin e os 7 dias da semana. */
    private String createSquad(String userId, String name, boolean personal) throws ApiException {
        String squadId = Rows.newId();
        write(db -> {
            ContentValues squad = new ContentValues();
            squad.put("id", squadId);
            squad.put("name", name.trim().isEmpty() ? "Meu Treino" : name.trim());
            squad.put("icon", "");
            squad.put("invite_code", uniqueInviteCode(db));
            squad.put("is_personal", personal ? 1 : 0);
            squad.put("created_by", userId);
            db.insertOrThrow("squads", null, squad);

            ContentValues member = new ContentValues();
            member.put("id", Rows.newId());
            member.put("squad_id", squadId);
            member.put("user_id", userId);
            member.put("role", "admin");
            db.insertOrThrow("squad_members", null, member);

            for (int i = 0; i < WEEK_DAYS.length; i++) {
                ContentValues day = new ContentValues();
                day.put("id", Rows.newId());
                day.put("squad_id", squadId);
                day.put("name", WEEK_DAYS[i]);
                day.put("focus", "");
                day.put("day_order", i);
                db.insertOrThrow("workout_days", null, day);
            }
        });
        return squadId;
    }

    private String joinSquadByCode(String userId, String code) throws ApiException {
        String normalized = code.trim().toUpperCase();
        SQLiteDatabase db = database.getReadableDatabase();

        String squadId;
        try (Cursor c = db.rawQuery(
                "SELECT id FROM squads WHERE invite_code = ? AND is_personal = 0", new String[]{normalized})) {
            if (!c.moveToFirst()) throw new ApiException(400, "codigo_invalido", "codigo_invalido");
            squadId = c.getString(0);
        }

        write(w -> w.execSQL(
            "INSERT OR IGNORE INTO squad_members (id, squad_id, user_id, role) VALUES (?, ?, ?, 'member')",
            new Object[]{Rows.newId(), squadId, userId}));
        return squadId;
    }

    private String uniqueInviteCode(SQLiteDatabase db) {
        // Sem 0/O e 1/I para não confundir ao digitar
        String alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        while (true) {
            StringBuilder code = new StringBuilder();
            for (int i = 0; i < 6; i++) code.append(alphabet.charAt(random.nextInt(alphabet.length())));
            try (Cursor c = db.rawQuery("SELECT 1 FROM squads WHERE invite_code = ?", new String[]{code.toString()})) {
                if (!c.moveToFirst()) return code.toString();
            }
        }
    }

    // ── Sessão de treino ──────────────────────────────────────────────────

    /** Fecha a sessão e calcula o volume (peso × reps das séries feitas no dia). */
    private JSONObject finishWorkoutSession(String userId, String sessionId) throws ApiException, JSONException {
        SQLiteDatabase db = database.getReadableDatabase();
        String date;
        try (Cursor c = db.rawQuery(
                "SELECT date FROM workout_sessions WHERE id = ? AND user_id = ?", new String[]{sessionId, userId})) {
            if (!c.moveToFirst()) throw new ApiException(404, "Sessão não encontrada.");
            date = c.getString(0);
        }

        double volume;
        try (Cursor c = db.rawQuery(
                "SELECT COALESCE(SUM(weight * reps), 0) FROM set_logs " +
                "WHERE user_id = ? AND date = ? AND done = 1 AND weight IS NOT NULL AND reps IS NOT NULL",
                new String[]{userId, date})) {
            c.moveToFirst();
            volume = c.getDouble(0);
        }

        write(w -> w.execSQL(
            "UPDATE workout_sessions SET ended_at = ?, total_volume = ? WHERE id = ?",
            new Object[]{Rows.now(), volume, sessionId}));

        JSONObject out = new JSONObject();
        out.put("id", sessionId);
        out.put("total_volume", volume);
        return out;
    }

    // ── Dieta ─────────────────────────────────────────────────────────────

    private JSONArray ensureMealRoutine(String userId) throws ApiException, JSONException {
        write(db -> {
            try (Cursor c = db.rawQuery("SELECT 1 FROM meal_slots WHERE user_id = ? LIMIT 1", new String[]{userId})) {
                if (c.moveToFirst()) return;
            }
            for (int i = 0; i < DEFAULT_SLOTS.length; i++) {
                ContentValues slot = new ContentValues();
                slot.put("id", Rows.newId());
                slot.put("user_id", userId);
                slot.put("name", DEFAULT_SLOTS[i][0]);
                slot.put("time_hint", DEFAULT_SLOTS[i][1]);
                slot.put("position", i);
                db.insertOrThrow("meal_slots", null, slot);
            }
        });
        return slots(userId);
    }

    /** Grava a rotina inteira: cria as novas, atualiza as existentes e apaga as removidas. */
    private JSONArray saveMealRoutine(String userId, JSONArray slots) throws ApiException, JSONException {
        if (slots == null) throw new ApiException(400, "p_slots é obrigatório.");

        write(db -> {
            Set<String> existing = new HashSet<>();
            try (Cursor c = db.rawQuery("SELECT id FROM meal_slots WHERE user_id = ?", new String[]{userId})) {
                while (c.moveToNext()) existing.add(c.getString(0));
            }

            Set<String> kept = new HashSet<>();
            for (int i = 0; i < slots.length(); i++) {
                JSONObject slot = slots.getJSONObject(i);
                String id = slot.isNull("id") ? null : slot.optString("id");

                ContentValues values = new ContentValues();
                values.put("name", slot.optString("name"));
                values.put("position", slot.optInt("position", i));
                values.put("time_hint", slot.isNull("time_hint") ? "" : slot.optString("time_hint"));
                values.put("kcal_goal", slot.optDouble("kcal_goal", 0));
                values.put("protein_goal", slot.optDouble("protein_goal", 0));
                values.put("carbs_goal", slot.optDouble("carbs_goal", 0));
                values.put("fat_goal", slot.optDouble("fat_goal", 0));

                if (id != null && existing.contains(id)) {
                    db.update("meal_slots", values, "id = ?", new String[]{id});
                    kept.add(id);
                } else {
                    values.put("id", Rows.newId());
                    values.put("user_id", userId);
                    db.insertOrThrow("meal_slots", null, values);
                }
            }

            // Refeições das rotinas apagadas ficam "fora da rotina"
            for (String id : existing) {
                if (kept.contains(id)) continue;
                db.execSQL("UPDATE meals SET slot_id = NULL WHERE user_id = ? AND slot_id = ?", new Object[]{userId, id});
                db.execSQL("DELETE FROM meal_slots WHERE id = ?", new Object[]{id});
            }
        });
        return slots(userId);
    }

    private JSONArray copyMealsFrom(String userId, String from, String to) throws ApiException, JSONException {
        write(db -> {
            List<ContentValues> copies = new ArrayList<>();
            try (Cursor c = db.rawQuery(
                    "SELECT name, calories, protein, carbs, fat, slot_id FROM meals " +
                    "WHERE user_id = ? AND date = ? ORDER BY created_at, rowid", new String[]{userId, from})) {
                while (c.moveToNext()) {
                    ContentValues meal = new ContentValues();
                    meal.put("id", Rows.newId());
                    meal.put("user_id", userId);
                    meal.put("date", to);
                    meal.put("name", c.getString(0));
                    for (int i = 1; i <= 4; i++) {
                        String column = c.getColumnName(i);
                        if (c.isNull(i)) meal.putNull(column);
                        else meal.put(column, c.getDouble(i));
                    }
                    meal.put("slot_id", c.getString(5));
                    copies.add(meal);
                }
            }
            for (ContentValues meal : copies) db.insertOrThrow("meals", null, meal);
        });
        return query("SELECT " + MEAL_COLUMNS + " FROM meals WHERE user_id = ? AND date = ? ORDER BY created_at, rowid",
            userId, to);
    }

    private JSONArray slots(String userId) throws JSONException {
        return query("SELECT " + SLOT_COLUMNS + " FROM meal_slots WHERE user_id = ? ORDER BY position", userId);
    }

    // ── Apoio ─────────────────────────────────────────────────────────────

    private JSONArray query(String sql, String... args) throws JSONException {
        return Rows.read(database.getReadableDatabase().rawQuery(sql, args));
    }

    interface Write {
        void run(SQLiteDatabase db) throws ApiException, JSONException;
    }

    /** Executa as escritas numa transação só (tudo ou nada). */
    private void write(Write work) throws ApiException {
        SQLiteDatabase db = database.getWritableDatabase();
        synchronized (database) {
            db.beginTransaction();
            try {
                work.run(db);
                db.setTransactionSuccessful();
            } catch (JSONException e) {
                throw new ApiException(400, "Parâmetros inválidos: " + e.getMessage());
            } finally {
                db.endTransaction();
            }
        }
    }
}
