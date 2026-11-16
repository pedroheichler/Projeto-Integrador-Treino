package com.kronos.server.ai;

import com.kronos.server.ApiTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** RF07 e RN05: rota /api/ai, com a API da Anthropic trocada pelo FakeAnthropic. */
class AiTest extends ApiTestBase {

    @Autowired
    private AiService ai;

    private Map<String, Object> chat(String text) {
        return Map.of(
            "operation", "workout-chat",
            "request", Map.of(
                "system", "Squad: Teste\nSequência atual: 3 dias consecutivos",
                "messages", List.of(Map.of("role", "user", "content", text))));
    }

    // ── RN05 ──────────────────────────────────────────────────────────────

    @Test
    void rn05_soExercicioComTresExecucoesEntraNoHistoricoDeCarga() {
        User ana = newUser("Ana");
        String squad = newSquad(ana, "Squad");
        String day = dayId(ana, squad, 0);
        String supino = newExercise(ana, day, "Supino reto");
        String rosca = newExercise(ana, day, "Rosca direta");

        // Supino: 3 dias diferentes com série concluída e carga anotada
        logSet(ana, supino, "2026-11-03", 0, 60.0, 10, true);
        logSet(ana, supino, "2026-11-05", 0, 62.5, 10, true);
        logSet(ana, supino, "2026-11-07", 0, 65.0, 8, true);
        // Rosca: só 2 execuções que contam (a terceira não foi concluída)
        logSet(ana, rosca, "2026-11-03", 0, 14.0, 12, true);
        logSet(ana, rosca, "2026-11-05", 0, 14.0, 12, true);
        logSet(ana, rosca, "2026-11-07", 0, 16.0, 10, false);

        String rule = ai.loadAdjustmentRule(ana.id);
        assertTrue(rule.contains("pelo menos 3 execuções"));
        assertTrue(rule.contains("Supino reto (3 execuções)"));
        assertTrue(rule.contains("2026-11-07 65.0 kg x 8"));
        assertFalse(rule.contains("Rosca direta"));

        // Sem histórico suficiente, a IA é avisada de que não pode sugerir ajuste
        assertTrue(ai.loadAdjustmentRule(newUser("Bruno").id).contains("Nenhum exercício do usuário tem 3 execuções"));
    }

    @Test
    void rn05_regraVaiNoPedidoParaAIA() {
        User ana = newUser("Ana");
        assertEquals(200, post("/ai", ana.token, chat("Posso aumentar a carga do supino?")).status);

        Map<String, Object> sent = ANTHROPIC.lastRequest();
        String system = sent.get("system").toString();
        assertTrue(system.contains("Regra de ajuste de carga"));
        assertTrue(system.contains("Sequência atual: 3 dias consecutivos"));
    }

    // ── RF07 ──────────────────────────────────────────────────────────────

    @Test
    void chatRespondeEmStreamingComTextoETreinoMontado() {
        User ana = newUser("Ana");
        Reply reply = post("/ai", ana.token, chat("Monta um treino de peito para segunda, tenho 30 minutos"));
        assertEquals(200, reply.status);

        // Texto chega aos poucos, no formato de eventos que a interface já lê
        assertTrue(reply.body.contains("\"type\":\"text_delta\""));
        assertTrue(reply.body.contains("Montei um treino "));
        assertTrue(reply.body.contains("de peito."));

        // E o treino montado pela ferramenta vem completo no fim
        assertTrue(reply.body.contains("\"name\":\"create_workout_day\""));
        assertTrue(reply.body.contains("\"day_name\":\"Segunda\""));
        assertTrue(reply.body.contains("\"name\":\"Supino reto\""));
        assertTrue(reply.body.contains("\"sets\":4"));
    }

    @Test
    void pedidoParaAIAUsaAChaveDoServidorEDeclaraAFerramenta() {
        User ana = newUser("Ana");
        post("/ai", ana.token, chat("Oi"));

        Map<String, Object> sent = ANTHROPIC.lastRequest();
        assertEquals("chave-de-teste", ANTHROPIC.lastApiKey());
        assertEquals("claude-opus-5-5", sent.get("model"));
        assertEquals(true, sent.get("stream"));
        assertEquals("low", ((Map<?, ?>) sent.get("output_config")).get("effort"));

        Map<?, ?> tool = (Map<?, ?>) ((List<?>) sent.get("tools")).get(0);
        assertEquals("create_workout_day", tool.get("name"));
        assertEquals(true, tool.get("strict"));
        assertEquals(List.of(Map.of("role", "user", "content", "Oi")), sent.get("messages"));
    }

    @Test
    void analiseDeComidaDevolveOConteudoDaResposta() {
        User ana = newUser("Ana");
        Map<String, Object> body = Map.of(
            "operation", "food-analysis",
            "request", Map.of("messages", List.of(Map.of(
                "role", "user",
                "content", List.of(
                    Map.of("type", "image", "source", Map.of("type", "base64", "media_type", "image/jpeg", "data", "/9j/4AAQ")),
                    Map.of("type", "text", "text", "Analise esta foto de comida."))))));

        Reply reply = post("/ai", ana.token, body);
        assertEquals(200, reply.status);
        assertTrue(reply.body.contains("\"content\":[{"));
        assertTrue(reply.body.contains("Arroz e feijão"));

        // A foto segue para a IA como bloco de imagem
        List<?> content = (List<?>) ((Map<?, ?>) ((List<?>) ANTHROPIC.lastRequest().get("messages")).get(0)).get("content");
        assertEquals("image", ((Map<?, ?>) content.get(0)).get("type"));
        assertEquals(false, ANTHROPIC.lastRequest().containsKey("tools"));
    }

    @Test
    void pedidosInvalidosSaoRecusados() {
        User ana = newUser("Ana");
        assertEquals(401, post("/ai", null, chat("Oi")).status);
        assertEquals(400, post("/ai", ana.token, Map.of("operation", "outra-coisa", "request", Map.of("messages", List.of()))).status);
        assertEquals(400, post("/ai", ana.token, Map.of("operation", "weekly-report", "request", Map.of("messages", List.of()))).status);
        assertEquals(400, post("/ai", ana.token, Map.of("operation", "workout-chat")).status);

        Map<String, Object> gif = Map.of("operation", "food-analysis", "request", Map.of("messages", List.of(Map.of(
            "role", "user",
            "content", List.of(Map.of("type", "image", "source", Map.of("type", "base64", "media_type", "image/gif", "data", "R0lG")))))));
        assertEquals(400, post("/ai", ana.token, gif).status);
    }
}
