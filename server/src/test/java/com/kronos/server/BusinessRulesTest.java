package com.kronos.server;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Regras de negócio do documento do projeto: RN01, RN02 e RN04 (a RN05 está em AiTest). */
class BusinessRulesTest extends ApiTestBase {

    private Set<String> completedDays(User asker, User of) {
        Reply reply = rpc(asker, "completed_training_days", Map.of("p_user_ids", List.of(of.id), "p_from", "2026-01-01"));
        assertEquals(200, reply.status);
        return reply.rows().stream().map(row -> (String) row.get("date")).collect(Collectors.toSet());
    }

    // ── RN01 ──────────────────────────────────────────────────────────────

    @Test
    void rn01_diaSoContaComTodosOsExerciciosConcluidos() {
        User ana = newUser("Ana");
        String squad = newSquad(ana, "Squad");
        String monday = dayId(ana, squad, 0);
        String supino = newExercise(ana, monday, "Supino");
        String crucifixo = newExercise(ana, monday, "Crucifixo");

        // Data no futuro: os exercícios acabaram de ser criados e só valem daqui para frente.
        // Só um dos dois exercícios concluído: o dia não entra na sequência
        markExercise(ana, supino, "2099-11-09", true);
        assertEquals(Set.of(), completedDays(ana, ana));

        // Os dois concluídos: o dia conta
        markExercise(ana, crucifixo, "2099-11-09", true);
        assertEquals(Set.of("2099-11-09"), completedDays(ana, ana));

        // Desmarcou um: deixa de contar
        markExercise(ana, supino, "2099-11-09", false);
        assertEquals(Set.of(), completedDays(ana, ana));
    }

    @Test
    void rn01_exercicioCriadoDepoisNaoDerrubaDiasAntigos() {
        User ana = newUser("Ana");
        String squad = newSquad(ana, "Squad");
        String monday = dayId(ana, squad, 0);
        String supino = newExercise(ana, monday, "Supino");

        // Supino feito numa data antiga e numa data futura; depois entra um exercício novo no dia
        markExercise(ana, supino, "2020-01-06", true);
        markExercise(ana, supino, "2099-01-05", true);
        newExercise(ana, monday, "Exercício novo");

        Set<String> days = rpc(ana, "completed_training_days", Map.of("p_user_ids", List.of(ana.id), "p_from", "2000-01-01"))
            .rows().stream().map(row -> (String) row.get("date")).collect(Collectors.toSet());

        // A data antiga continua valendo: o exercício novo ainda não existia.
        // A data futura deixa de contar: nela o exercício novo já faz parte do treino.
        assertEquals(Set.of("2020-01-06"), days);
    }

    @Test
    void rn01_soMostraDiasDeQuemDivideSquad() {
        User ana = newUser("Ana");
        User bruno = newUser("Bruno");
        User estranho = newUser("Estranho");
        String squad = newSquad(ana, "Squad");
        rpc(bruno, "join_squad_by_code", Map.of("p_code", inviteCode(ana, squad)));
        String exercise = newExercise(ana, dayId(ana, squad, 1), "Rosca");
        markExercise(ana, exercise, "2026-11-10", true);

        assertEquals(Set.of("2026-11-10"), completedDays(bruno, ana));
        assertEquals(Set.of(), completedDays(estranho, ana));
    }

    // ── RN02 ──────────────────────────────────────────────────────────────

    @Test
    void rn02_recordeEMaiorCargaConcluidaEDepoisMaisRepeticoes() {
        User ana = newUser("Ana");
        String squad = newSquad(ana, "Squad");
        String exercise = newExercise(ana, dayId(ana, squad, 0), "Agachamento");

        logSet(ana, exercise, "2026-11-03", 0, 60.0, 10, true);
        logSet(ana, exercise, "2026-11-05", 0, 80.0, 5, true);
        logSet(ana, exercise, "2026-11-07", 0, 80.0, 8, true);
        // Série com mais carga, mas não concluída: não é recorde
        logSet(ana, exercise, "2026-11-09", 0, 100.0, 1, false);

        List<Map<String, Object>> records = rpc(ana, "exercise_personal_records", Map.of()).rows();
        assertEquals(1, records.size());
        assertEquals(exercise, records.get(0).get("exercise_id"));
        assertEquals(80.0, ((Number) records.get(0).get("best_weight")).doubleValue());
        assertEquals(8, records.get(0).get("best_reps"));
    }

    // ── RN04 ──────────────────────────────────────────────────────────────

    @Test
    void rn04_soAdminMexeNoConviteENosMembros() {
        User ana = newUser("Ana");
        User bruno = newUser("Bruno");
        User carla = newUser("Carla");
        String squad = newSquad(ana, "Squad");
        String code = inviteCode(ana, squad);
        rpc(bruno, "join_squad_by_code", Map.of("p_code", code));
        rpc(carla, "join_squad_by_code", Map.of("p_code", code));

        // Membro comum é barrado nas três operações
        for (Reply reply : List.of(
                rpc(bruno, "regenerate_invite_code", Map.of("p_squad_id", squad)),
                rpc(bruno, "revoke_invite_code", Map.of("p_squad_id", squad)),
                rpc(bruno, "remove_squad_member", Map.of("p_squad_id", squad, "p_user_id", carla.id)))) {
            assertEquals(403, reply.status);
            assertEquals("apenas_admin", reply.errorCode());
        }
        assertEquals(code, inviteCode(ana, squad));
        assertEquals(3, select(ana, "squad_members", "id", "squad_id", "eq", squad).rows().size());
    }

    @Test
    void rn04_codigoNovoInvalidaOAntigoERevogarFechaOSquad() {
        User ana = newUser("Ana");
        User bruno = newUser("Bruno");
        String squad = newSquad(ana, "Squad");
        String oldCode = inviteCode(ana, squad);

        String newCode = (String) rpc(ana, "regenerate_invite_code", Map.of("p_squad_id", squad)).data;
        assertNotEquals(oldCode, newCode);
        assertEquals(newCode, inviteCode(ana, squad));

        Reply withOld = rpc(bruno, "join_squad_by_code", Map.of("p_code", oldCode));
        assertEquals(400, withOld.status);
        assertEquals("codigo_invalido", withOld.errorCode());

        assertEquals(200, rpc(ana, "revoke_invite_code", Map.of("p_squad_id", squad)).status);
        assertNull(inviteCode(ana, squad));
        assertEquals(400, rpc(bruno, "join_squad_by_code", Map.of("p_code", newCode)).status);
        assertEquals(400, rpc(bruno, "join_squad_by_code", Map.of("p_code", "")).status);

        // Gerar de novo reabre a entrada
        String reopened = (String) rpc(ana, "regenerate_invite_code", Map.of("p_squad_id", squad)).data;
        assertEquals(200, rpc(bruno, "join_squad_by_code", Map.of("p_code", reopened.toLowerCase())).status);
    }

    @Test
    void rn04_adminRemoveMembroMasNaoASiMesmo() {
        User ana = newUser("Ana");
        User bruno = newUser("Bruno");
        String squad = newSquad(ana, "Squad");
        rpc(bruno, "join_squad_by_code", Map.of("p_code", inviteCode(ana, squad)));

        assertEquals(400, rpc(ana, "remove_squad_member", Map.of("p_squad_id", squad, "p_user_id", ana.id)).status);
        assertEquals(200, rpc(ana, "remove_squad_member", Map.of("p_squad_id", squad, "p_user_id", bruno.id)).status);

        // Removido, Bruno deixa de enxergar o squad
        assertEquals(0, select(bruno, "squads", "id", "id", "eq", squad).rows().size());
        assertEquals(1, select(ana, "squad_members", "id", "squad_id", "eq", squad).rows().size());
    }

    // ── Demais funções ────────────────────────────────────────────────────

    @Test
    void criarSquadMontaOsSeteDiasComOCriadorComoAdmin() {
        User ana = newUser("Ana");
        String squad = newSquad(ana, "  Os Brutos  ");

        assertEquals("Os Brutos", select(ana, "squads", "name", "id", "eq", squad).rows().get(0).get("name"));
        assertEquals(6, inviteCode(ana, squad).length());
        assertEquals("admin", select(ana, "squad_members", "role", "squad_id", "eq", squad).rows().get(0).get("role"));

        Map<String, Object> days = with(with(query("workout_days", "select"), "columns", "name"),
            "order", List.of(Map.of("column", "day_order", "ascending", true)));
        filter(days, "squad_id", "eq", squad);
        List<Object> names = post("/query", ana.token, days).rows().stream().map(row -> row.get("name")).collect(Collectors.toList());
        assertEquals(List.of("Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"), names);
    }

    @Test
    void encerrarSessaoCalculaOVolumeDoDia() {
        User ana = newUser("Ana");
        String squad = newSquad(ana, "Squad");
        String exercise = newExercise(ana, dayId(ana, squad, 0), "Leg press");
        logSet(ana, exercise, "2026-11-10", 0, 100.0, 10, true);
        logSet(ana, exercise, "2026-11-10", 1, 120.0, 8, true);
        logSet(ana, exercise, "2026-11-10", 2, 140.0, 6, false);

        String session = (String) insert(ana, "workout_sessions", Map.of("date", "2026-11-10")).get("id");
        Reply finished = rpc(ana, "finish_workout_session", Map.of("p_session_id", session));
        assertEquals(200, finished.status);
        // 100×10 + 120×8; a série não concluída fica de fora
        assertEquals(1960.0, ((Number) finished.map().get("total_volume")).doubleValue());

        // Sessão de outra pessoa não é encerrável
        assertEquals(404, rpc(newUser("Bruno"), "finish_workout_session", Map.of("p_session_id", session)).status);
    }

    @Test
    void rotinaAlimentarCopiaDeRefeicoesETotaisDoDia() {
        User ana = newUser("Ana");

        List<Map<String, Object>> slots = rpc(ana, "ensure_meal_routine", Map.of()).rows();
        assertEquals(6, slots.size());
        assertEquals("Café da manhã", slots.get(0).get("name"));
        // Chamar de novo não duplica
        assertEquals(6, rpc(ana, "ensure_meal_routine", Map.of()).rows().size());

        // Salva a rotina só com duas refeições: uma existente renomeada e uma nova
        Map<String, Object> kept = new LinkedHashMap<>(slots.get(0));
        kept.put("name", "Desjejum");
        Map<String, Object> created = new LinkedHashMap<>();
        created.put("id", null);
        created.put("name", "Pós-treino");
        created.put("position", 1);
        List<Map<String, Object>> saved = rpc(ana, "save_meal_routine", Map.of("p_slots", List.of(kept, created))).rows();
        assertEquals(List.of("Desjejum", "Pós-treino"),
            saved.stream().map(slot -> slot.get("name")).collect(Collectors.toList()));

        Map<String, Object> meal = new LinkedHashMap<>();
        meal.put("name", "Omelete");
        meal.put("date", "2026-11-09");
        meal.put("calories", 300);
        meal.put("protein", 25);
        meal.put("slot_id", saved.get(0).get("id"));
        insert(ana, "meals", meal);
        meal.put("name", "Frango");
        meal.put("calories", 450);
        meal.put("protein", 40);
        insert(ana, "meals", meal);

        List<Map<String, Object>> copied = rpc(ana, "copy_meals_from", Map.of("p_from", "2026-11-09", "p_to", "2026-11-10")).rows();
        assertEquals(List.of("Omelete", "Frango"), copied.stream().map(m -> m.get("name")).collect(Collectors.toList()));

        List<Map<String, Object>> totals = rpc(ana, "diet_daily_totals", Map.of("p_from", "2026-11-09", "p_to", "2026-11-10")).rows();
        assertEquals(2, totals.size());
        assertEquals("2026-11-09", totals.get(0).get("date"));
        assertEquals(750.0, ((Number) totals.get(0).get("kcal")).doubleValue());
        assertEquals(65.0, ((Number) totals.get(1).get("protein")).doubleValue());
    }
}
