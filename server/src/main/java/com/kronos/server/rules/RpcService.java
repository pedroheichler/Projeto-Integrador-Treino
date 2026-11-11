package com.kronos.server.rules;

import com.kronos.server.data.Rows;
import com.kronos.server.web.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.security.SecureRandom;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Regras de negócio do Kronos, chamadas pela interface em /api/rpc/{nome}.
 * Cada função faz várias operações de uma vez, dentro de uma transação.
 *
 * Regras do documento do projeto implementadas aqui:
 * RN01 (sequência só conta treino completo), RN02 (recorde por carga e
 * repetições) e RN04 (só o admin mexe no convite e nos membros).
 * A RN05 fica em {@code AiService}, junto da chamada à IA.
 */
@Service
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

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final SecureRandom random = new SecureRandom();

    public RpcService(JdbcTemplate jdbc, TransactionTemplate transaction) {
        this.jdbc = jdbc;
        this.transaction = transaction;
    }

    public Object call(String name, String userId, Map<String, Object> args) {
        return transaction.execute(status -> run(name, userId, args));
    }

    private Object run(String name, String userId, Map<String, Object> args) {
        switch (name) {
            case "create_squad":
                return createSquad(userId, text(args, "p_name"), Boolean.TRUE.equals(args.get("p_personal")));
            case "join_squad_by_code":
                return joinSquadByCode(userId, text(args, "p_code"));
            case "regenerate_invite_code":
                return regenerateInviteCode(userId, text(args, "p_squad_id"));
            case "revoke_invite_code":
                return revokeInviteCode(userId, text(args, "p_squad_id"));
            case "remove_squad_member":
                return removeSquadMember(userId, text(args, "p_squad_id"), text(args, "p_user_id"));
            case "completed_training_days":
                return completedTrainingDays(userId, args.get("p_user_ids"), text(args, "p_from"));
            case "exercise_personal_records":
                return personalRecords(userId);
            case "finish_workout_session":
                return finishWorkoutSession(userId, text(args, "p_session_id"));
            case "ensure_meal_routine":
                return ensureMealRoutine(userId);
            case "save_meal_routine":
                return saveMealRoutine(userId, args.get("p_slots"));
            case "increment_favorite_use":
                jdbc.update("UPDATE favorite_meals SET times_used = times_used + 1 WHERE id = ? AND user_id = ?",
                    text(args, "p_id"), userId);
                return null;
            case "copy_meals_from":
                return copyMealsFrom(userId, date(args, "p_from"), date(args, "p_to"));
            case "diet_daily_totals":
                return jdbc.query(
                    "SELECT date, COALESCE(SUM(calories), 0) AS kcal, COALESCE(SUM(protein), 0) AS protein " +
                    "FROM meals WHERE user_id = ? AND date BETWEEN ? AND ? GROUP BY date ORDER BY date",
                    Rows.MAPPER, userId, date(args, "p_from"), date(args, "p_to"));
            default:
                throw new ApiException(404, "Função não encontrada: " + name);
        }
    }

    // ── Squads ────────────────────────────────────────────────────────────

    /** Cria o squad (ou o espaço pessoal) com o criador como admin e os 7 dias da semana. */
    private String createSquad(String userId, String name, boolean personal) {
        String squadId = Rows.newId();
        jdbc.update(
            "INSERT INTO squads (id, name, icon, invite_code, is_personal, created_by) VALUES (?, ?, '', ?, ?, ?)",
            squadId, name.isBlank() ? "Meu Treino" : name.trim(), uniqueInviteCode(), personal, userId);
        jdbc.update("INSERT INTO squad_members (id, squad_id, user_id, role) VALUES (?, ?, ?, 'admin')",
            Rows.newId(), squadId, userId);

        for (int i = 0; i < WEEK_DAYS.length; i++) {
            jdbc.update("INSERT INTO workout_days (id, squad_id, name, focus, day_order) VALUES (?, ?, ?, '', ?)",
                Rows.newId(), squadId, WEEK_DAYS[i], i);
        }
        return squadId;
    }

    private String joinSquadByCode(String userId, String code) {
        String normalized = code.trim().toUpperCase();
        List<String> found = normalized.isEmpty() ? List.of() : jdbc.queryForList(
            "SELECT id FROM squads WHERE invite_code = ? AND is_personal = FALSE", String.class, normalized);
        if (found.isEmpty()) throw new ApiException(400, "codigo_invalido", "codigo_invalido");
        String squadId = found.get(0);

        // Squad que ficou vazio: quem volta assume como admin
        Integer admins = jdbc.queryForObject(
            "SELECT COUNT(*) FROM squad_members WHERE squad_id = ? AND role = 'admin'", Integer.class, squadId);
        String role = admins != null && admins > 0 ? "member" : "admin";

        jdbc.update(
            "INSERT INTO squad_members (id, squad_id, user_id, role) VALUES (?, ?, ?, ?) " +
            "ON CONFLICT (squad_id, user_id) DO NOTHING",
            Rows.newId(), squadId, userId, role);
        return squadId;
    }

    /** RN04: só o admin do squad gera um código de convite novo (o antigo deixa de valer). */
    private String regenerateInviteCode(String userId, String squadId) {
        requireAdmin(userId, squadId);
        String code = uniqueInviteCode();
        jdbc.update("UPDATE squads SET invite_code = ? WHERE id = ?", code, squadId);
        return code;
    }

    /** RN04: só o admin revoga o código; sem código ninguém novo entra no squad. */
    private Object revokeInviteCode(String userId, String squadId) {
        requireAdmin(userId, squadId);
        jdbc.update("UPDATE squads SET invite_code = NULL WHERE id = ?", squadId);
        return null;
    }

    /** RN04: só o admin remove membros. Ele mesmo sai pelo "Sair do squad". */
    private Object removeSquadMember(String userId, String squadId, String memberId) {
        requireAdmin(userId, squadId);
        if (memberId.equals(userId)) {
            throw new ApiException(400, "O admin não pode remover a si mesmo.", "admin_nao_removivel");
        }
        jdbc.update("DELETE FROM squad_members WHERE squad_id = ? AND user_id = ?", squadId, memberId);
        return null;
    }

    private void requireAdmin(String userId, String squadId) {
        List<String> role = jdbc.queryForList(
            "SELECT role FROM squad_members WHERE squad_id = ? AND user_id = ?", String.class, squadId, userId);
        if (role.isEmpty() || !"admin".equals(role.get(0))) {
            throw new ApiException(403, "Só o administrador do squad pode fazer isso.", "apenas_admin");
        }
    }

    private String uniqueInviteCode() {
        // Sem 0/O e 1/I para não confundir ao digitar
        String alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        while (true) {
            StringBuilder code = new StringBuilder();
            for (int i = 0; i < 6; i++) code.append(alphabet.charAt(random.nextInt(alphabet.length())));
            Integer taken = jdbc.queryForObject(
                "SELECT COUNT(*) FROM squads WHERE invite_code = ?", Integer.class, code.toString());
            if (taken == null || taken == 0) return code.toString();
        }
    }

    // ── Sequência e recordes ──────────────────────────────────────────────

    /**
     * RN01: dias em que o treino foi concluído por inteiro. Um dia só conta
     * quando todos os exercícios do treino feito naquela data estão marcados
     * como concluídos; exercícios criados depois da data não entram na conta.
     * Devolve os dias do próprio usuário e de quem divide um squad com ele.
     */
    private List<Map<String, Object>> completedTrainingDays(String userId, Object userIds, String from) {
        Set<String> allowed = new HashSet<>(jdbc.queryForList(
            "SELECT DISTINCT other.user_id FROM squad_members mine " +
            "JOIN squad_members other ON other.squad_id = mine.squad_id WHERE mine.user_id = ?",
            String.class, userId));
        allowed.add(userId);

        List<Object> args = new ArrayList<>();
        if (userIds instanceof List && !((List<?>) userIds).isEmpty()) {
            for (Object id : (List<?>) userIds) {
                if (id != null && allowed.contains(id.toString()) && !args.contains(id.toString())) {
                    args.add(id.toString());
                }
            }
        } else {
            args.add(userId);
        }
        if (args.isEmpty()) return List.of();

        String users = Rows.placeholders(args.size());
        args.add(from.isBlank() ? LocalDate.of(1970, 1, 1) : parseDate(from, "p_from"));
        return jdbc.query(
            "SELECT DISTINCT p.user_id, p.date FROM exercise_progress p " +
            "JOIN exercises e ON e.id = p.exercise_id " +
            "WHERE p.completed AND p.user_id IN (" + users + ") AND p.date >= ? " +
            "GROUP BY p.user_id, p.date, e.workout_day_id " +
            "HAVING COUNT(DISTINCT p.exercise_id) >= (" +
            "  SELECT COUNT(*) FROM exercises planned " +
            "  WHERE planned.workout_day_id = e.workout_day_id " +
            "  AND (planned.created_at AT TIME ZONE 'UTC')::date <= p.date)",
            Rows.MAPPER, args.toArray());
    }

    /**
     * RN02: recorde de cada exercício = série concluída com a maior carga;
     * no empate de carga vale a que teve mais repetições.
     */
    private List<Map<String, Object>> personalRecords(String userId) {
        return jdbc.query(
            "SELECT s.exercise_id, s.weight AS best_weight, MAX(s.reps) AS best_reps FROM set_logs s " +
            "WHERE s.user_id = ? AND s.done AND s.weight IS NOT NULL AND s.weight = (" +
            "  SELECT MAX(top.weight) FROM set_logs top " +
            "  WHERE top.user_id = s.user_id AND top.exercise_id = s.exercise_id " +
            "  AND top.done AND top.weight IS NOT NULL) " +
            "GROUP BY s.exercise_id, s.weight",
            Rows.MAPPER, userId);
    }

    // ── Sessão de treino ──────────────────────────────────────────────────

    /** Fecha a sessão e calcula o volume (peso × reps das séries feitas no dia). */
    private Map<String, Object> finishWorkoutSession(String userId, String sessionId) {
        List<LocalDate> dates = jdbc.queryForList(
            "SELECT date FROM workout_sessions WHERE id = ? AND user_id = ?", LocalDate.class, sessionId, userId);
        if (dates.isEmpty()) throw new ApiException(404, "Sessão não encontrada.");

        Double volume = jdbc.queryForObject(
            "SELECT COALESCE(SUM(weight * reps), 0) FROM set_logs " +
            "WHERE user_id = ? AND date = ? AND done AND weight IS NOT NULL AND reps IS NOT NULL",
            Double.class, userId, dates.get(0));

        jdbc.update("UPDATE workout_sessions SET ended_at = clock_timestamp(), total_volume = ? WHERE id = ?",
            volume, sessionId);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", sessionId);
        out.put("total_volume", volume);
        return out;
    }

    // ── Dieta ─────────────────────────────────────────────────────────────

    private List<Map<String, Object>> ensureMealRoutine(String userId) {
        Integer existing = jdbc.queryForObject(
            "SELECT COUNT(*) FROM meal_slots WHERE user_id = ?", Integer.class, userId);
        if (existing == null || existing == 0) {
            for (int i = 0; i < DEFAULT_SLOTS.length; i++) {
                jdbc.update("INSERT INTO meal_slots (id, user_id, name, time_hint, position) VALUES (?, ?, ?, ?, ?)",
                    Rows.newId(), userId, DEFAULT_SLOTS[i][0], DEFAULT_SLOTS[i][1], i);
            }
        }
        return slots(userId);
    }

    /** Grava a rotina inteira: cria as novas, atualiza as existentes e apaga as removidas. */
    private List<Map<String, Object>> saveMealRoutine(String userId, Object slots) {
        if (!(slots instanceof List)) throw new ApiException(400, "p_slots é obrigatório.");

        Set<String> existing = new HashSet<>(
            jdbc.queryForList("SELECT id FROM meal_slots WHERE user_id = ?", String.class, userId));
        Set<String> kept = new HashSet<>();

        int index = 0;
        for (Object raw : (List<?>) slots) {
            if (!(raw instanceof Map)) throw new ApiException(400, "Parâmetros inválidos: p_slots.");
            Map<?, ?> slot = (Map<?, ?>) raw;

            Object id = slot.get("id");
            String name = slot.get("name") == null ? "" : slot.get("name").toString();
            int position = slot.get("position") instanceof Number ? ((Number) slot.get("position")).intValue() : index;
            String timeHint = slot.get("time_hint") == null ? "" : slot.get("time_hint").toString();
            double kcal = number(slot.get("kcal_goal"));
            double protein = number(slot.get("protein_goal"));
            double carbs = number(slot.get("carbs_goal"));
            double fat = number(slot.get("fat_goal"));

            if (id != null && existing.contains(id.toString())) {
                jdbc.update(
                    "UPDATE meal_slots SET name = ?, position = ?, time_hint = ?, kcal_goal = ?, " +
                    "protein_goal = ?, carbs_goal = ?, fat_goal = ? WHERE id = ? AND user_id = ?",
                    name, position, timeHint, kcal, protein, carbs, fat, id.toString(), userId);
                kept.add(id.toString());
            } else {
                jdbc.update(
                    "INSERT INTO meal_slots (id, user_id, name, position, time_hint, kcal_goal, " +
                    "protein_goal, carbs_goal, fat_goal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    Rows.newId(), userId, name, position, timeHint, kcal, protein, carbs, fat);
            }
            index++;
        }

        // Refeições das rotinas apagadas ficam "fora da rotina" (slot_id vira NULL pela chave estrangeira)
        for (String id : existing) {
            if (!kept.contains(id)) jdbc.update("DELETE FROM meal_slots WHERE id = ? AND user_id = ?", id, userId);
        }
        return slots(userId);
    }

    private List<Map<String, Object>> copyMealsFrom(String userId, LocalDate from, LocalDate to) {
        List<Map<String, Object>> meals = jdbc.queryForList(
            "SELECT name, calories, protein, carbs, fat, slot_id FROM meals " +
            "WHERE user_id = ? AND date = ? ORDER BY created_at", userId, from);
        for (Map<String, Object> meal : meals) {
            jdbc.update(
                "INSERT INTO meals (id, user_id, date, name, calories, protein, carbs, fat, slot_id) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                Rows.newId(), userId, to, meal.get("name"), meal.get("calories"), meal.get("protein"),
                meal.get("carbs"), meal.get("fat"), meal.get("slot_id"));
        }
        return jdbc.query(
            "SELECT " + MEAL_COLUMNS + " FROM meals WHERE user_id = ? AND date = ? ORDER BY created_at",
            Rows.MAPPER, userId, to);
    }

    private List<Map<String, Object>> slots(String userId) {
        return jdbc.query(
            "SELECT " + SLOT_COLUMNS + " FROM meal_slots WHERE user_id = ? ORDER BY position", Rows.MAPPER, userId);
    }

    // ── Apoio ─────────────────────────────────────────────────────────────

    private static String text(Map<String, Object> args, String key) {
        Object value = args.get(key);
        return value == null ? "" : value.toString();
    }

    private static LocalDate date(Map<String, Object> args, String key) {
        return parseDate(text(args, key), key);
    }

    private static LocalDate parseDate(String value, String key) {
        try {
            return LocalDate.parse(value.trim());
        } catch (RuntimeException invalid) {
            throw new ApiException(400, "Data inválida em " + key + ".");
        }
    }

    private static double number(Object value) {
        return value instanceof Number ? ((Number) value).doubleValue() : 0;
    }
}
