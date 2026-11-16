package com.kronos.server;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** CRUD genérico: formatos, upsert e, principalmente, quem enxerga o quê. */
class QueryTest extends ApiTestBase {

    private Map<String, Object> meal(String name, String date, double kcal) {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("name", name);
        values.put("date", date);
        values.put("calories", kcal);
        return values;
    }

    @Test
    void insertDevolveALinhaNosFormatosQueAInterfaceEspera() {
        User ana = newUser("Ana");
        Map<String, Object> row = insert(ana, "meals", meal("Almoço", "2026-11-10", 650));

        assertEquals(36, ((String) row.get("id")).length());
        assertEquals(ana.id, row.get("user_id"));
        assertEquals("2026-11-10", row.get("date"));
        assertEquals(650.0, ((Number) row.get("calories")).doubleValue());
        // Horário em ISO-8601 UTC com milissegundos, igual ao toISOString() do JavaScript
        assertTrue(((String) row.get("created_at")).matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z"));
    }

    @Test
    void dadosPessoaisSoAparecemParaODono() {
        User ana = newUser("Ana");
        User bruno = newUser("Bruno");
        String mealId = (String) insert(ana, "meals", meal("Jantar", "2026-11-10", 500)).get("id");

        assertEquals(1, select(ana, "meals", "id").rows().size());
        assertEquals(0, select(bruno, "meals", "id").rows().size());
        assertEquals(0, select(bruno, "meals", "id", "id", "eq", mealId).rows().size());

        // Bruno tenta alterar e apagar a refeição da Ana: nada acontece
        Map<String, Object> update = with(filter(query("meals", "update"), "id", "eq", mealId), "values", Map.of("name", "Hackeado"));
        assertEquals(200, post("/query", bruno.token, update).status);
        assertEquals(200, post("/query", bruno.token, filter(query("meals", "delete"), "id", "eq", mealId)).status);
        assertEquals("Jantar", select(ana, "meals", "name", "id", "eq", mealId).rows().get(0).get("name"));
    }

    @Test
    void linhaSemprePertenceAQuemEstaLogado() {
        User ana = newUser("Ana");
        User bruno = newUser("Bruno");

        // Bruno manda user_id da Ana: o servidor ignora e grava como Bruno
        Map<String, Object> values = meal("Lanche", "2026-11-10", 200);
        values.put("user_id", ana.id);
        assertEquals(bruno.id, insert(bruno, "meals", values).get("user_id"));
        assertEquals(0, select(ana, "meals", "id").rows().size());
    }

    @Test
    void upsertAtualizaEmVezDeDuplicar() {
        User ana = newUser("Ana");
        String squad = newSquad(ana, "Squad");
        String exercise = newExercise(ana, dayId(ana, squad, 0), "Agachamento");

        assertEquals(200, logSet(ana, exercise, "2026-11-10", 0, 60.0, 10, false).status);
        assertEquals(200, logSet(ana, exercise, "2026-11-10", 0, 62.5, 8, true).status);

        List<Map<String, Object>> logs = select(ana, "set_logs", "weight, reps, done").rows();
        assertEquals(1, logs.size());
        assertEquals(62.5, ((Number) logs.get(0).get("weight")).doubleValue());
        assertEquals(8, logs.get(0).get("reps"));
        assertEquals(true, logs.get(0).get("done"));
    }

    @Test
    void selectTrazRelacaoEmbutida() {
        User ana = newUser("Ana");
        String squad = newSquad(ana, "Squad");
        String exercise = newExercise(ana, dayId(ana, squad, 0), "Remada");
        logSet(ana, exercise, "2026-11-10", 0, 40.0, 12, true);

        Map<String, Object> log = select(ana, "set_logs", "exercise_id, weight, exercises(name)").rows().get(0);
        assertEquals("Remada", ((Map<?, ?>) log.get("exercises")).get("name"));

        Map<String, Object> membership = select(ana, "squad_members", "squad_id, squads(is_personal)", "user_id", "eq", ana.id)
            .rows().get(0);
        assertEquals(false, ((Map<?, ?>) membership.get("squads")).get("is_personal"));
    }

    @Test
    void filtrosOrdemELimite() {
        User ana = newUser("Ana");
        insert(ana, "meals", meal("A", "2026-11-08", 100));
        insert(ana, "meals", meal("B", "2026-11-09", 200));
        insert(ana, "meals", meal("C", "2026-11-10", 300));

        Map<String, Object> query = with(query("meals", "select"), "columns", "name");
        filter(query, "date", "gte", "2026-11-09");
        filter(query, "name", "in", List.of("A", "B", "C"));
        with(query, "order", List.of(Map.of("column", "date", "ascending", false)));
        with(query, "limit", 1);

        List<Map<String, Object>> rows = post("/query", ana.token, query).rows();
        assertEquals(List.of(Map.of("name", "C")), rows);
    }

    @Test
    void tabelaOuColunaDesconhecidaERecusada() {
        User ana = newUser("Ana");
        assertEquals(400, select(ana, "users", "*").status);
        assertEquals(400, select(ana, "auth_sessions", "*").status);
        assertEquals(400, select(ana, "meals", "name; DROP TABLE meals").status);
        assertEquals(400, select(ana, "meals", "id", "id\" = '' OR 1=1 --", "eq", "x").status);
        assertEquals(400, select(ana, "meals", "id", "date", "eq", "não é data").status);
    }

    @Test
    void quemNaoEDoSquadNaoVeNemMexeNoPlano() {
        User ana = newUser("Ana");
        User bruno = newUser("Bruno");
        String squad = newSquad(ana, "Squad da Ana");
        String day = dayId(ana, squad, 0);
        String exercise = newExercise(ana, day, "Supino");

        assertEquals(0, select(bruno, "squads", "id", "id", "eq", squad).rows().size());
        assertEquals(0, select(bruno, "workout_days", "id", "squad_id", "eq", squad).rows().size());
        assertEquals(0, select(bruno, "exercises", "id", "id", "eq", exercise).rows().size());

        // Não consegue criar exercício no dia de um squad que não é dele
        Map<String, Object> values = Map.of("workout_day_id", day, "name", "Intruso");
        Reply reply = post("/query", bruno.token, with(query("exercises", "insert"), "values", values));
        assertEquals(403, reply.status);

        // Nem apagar o que existe
        post("/query", bruno.token, filter(query("exercises", "delete"), "id", "eq", exercise));
        assertEquals(1, select(ana, "exercises", "id", "id", "eq", exercise).rows().size());
    }

    @Test
    void membroVeOPlanoMasSoAdminEditaOSquad() {
        User ana = newUser("Ana");
        User bruno = newUser("Bruno");
        String squad = newSquad(ana, "Original");
        rpc(bruno, "join_squad_by_code", Map.of("p_code", inviteCode(ana, squad)));

        // Membro enxerga squad e plano, mas não o código de convite
        Map<String, Object> seen = select(bruno, "squads", "id, name, invite_code", "id", "eq", squad).rows().get(0);
        assertEquals("Original", seen.get("name"));
        assertNull(seen.get("invite_code"));
        assertEquals(7, select(bruno, "workout_days", "id", "squad_id", "eq", squad).rows().size());

        // Membro tenta renomear: nada muda. Admin consegue.
        Map<String, Object> rename = with(filter(query("squads", "update"), "id", "eq", squad), "values", Map.of("name", "Do Bruno"));
        post("/query", bruno.token, rename);
        assertEquals("Original", select(ana, "squads", "name", "id", "eq", squad).rows().get(0).get("name"));

        Map<String, Object> adminRename = with(filter(query("squads", "update"), "id", "eq", squad),
            "values", Map.of("name", "Novo nome", "invite_code", "AAAAAA"));
        post("/query", ana.token, adminRename);
        Map<String, Object> after = select(ana, "squads", "name, invite_code", "id", "eq", squad).rows().get(0);
        assertEquals("Novo nome", after.get("name"));
        // O código só muda pelas funções do RpcService, nunca pelo update genérico
        assertTrue(after.get("invite_code") != null && !after.get("invite_code").equals("AAAAAA"));
    }

    @Test
    void codigoDeConviteNaoVazaPorFiltroNemOrdenacao() {
        User ana = newUser("Ana");
        User bruno = newUser("Bruno");
        String squad = newSquad(ana, "Squad");
        String code = inviteCode(ana, squad);
        rpc(bruno, "join_squad_by_code", Map.of("p_code", code));

        // Sem isso, o membro testaria "invite_code >= 'A...'" até descobrir o código
        assertEquals(403, select(bruno, "squads", "id", "invite_code", "eq", code).status);
        assertEquals(403, select(bruno, "squads", "id", "invite_code", "gte", "A").status);
        Map<String, Object> ordered = with(with(query("squads", "select"), "columns", "id"),
            "order", List.of(Map.of("column", "invite_code", "ascending", true)));
        assertEquals(403, post("/query", bruno.token, ordered).status);

        // update e delete passam pelos mesmos filtros
        Map<String, Object> update = with(filter(query("squads", "update"), "invite_code", "eq", code), "values", Map.of("name", "x"));
        assertEquals(403, post("/query", bruno.token, update).status);
    }

    @Test
    void ninguemEntraEmSquadSemConvite() {
        User ana = newUser("Ana");
        User bruno = newUser("Bruno");
        String squad = newSquad(ana, "Fechado");

        Map<String, Object> values = Map.of("squad_id", squad, "user_id", bruno.id, "role", "admin");
        Reply reply = post("/query", bruno.token, with(query("squad_members", "insert"), "values", values));
        assertEquals(403, reply.status);
        assertEquals(1, select(ana, "squad_members", "user_id", "squad_id", "eq", squad).rows().size());
    }

    @Test
    void quandoOAdminSaiOMembroMaisAntigoAssume() {
        User ana = newUser("Ana");
        User bruno = newUser("Bruno");
        User carla = newUser("Carla");
        String squad = newSquad(ana, "Squad");
        String code = inviteCode(ana, squad);
        rpc(bruno, "join_squad_by_code", Map.of("p_code", code));
        rpc(carla, "join_squad_by_code", Map.of("p_code", code));

        Map<String, Object> leave = filter(filter(query("squad_members", "delete"), "user_id", "eq", ana.id), "squad_id", "eq", squad);
        assertEquals(200, post("/query", ana.token, leave).status);

        List<Map<String, Object>> members = select(bruno, "squad_members", "user_id, role", "squad_id", "eq", squad).rows();
        assertEquals(2, members.size());
        for (Map<String, Object> member : members) {
            assertEquals(member.get("user_id").equals(bruno.id) ? "admin" : "member", member.get("role"));
        }
    }
}
