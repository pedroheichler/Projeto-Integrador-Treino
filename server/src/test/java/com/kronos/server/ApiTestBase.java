package com.kronos.server;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Base dos testes: sobe o servidor inteiro numa porta livre, sobre um
 * PostgreSQL de verdade (embutido), e fala com ele por HTTP como a interface.
 * No lugar da API da Anthropic entra o {@link FakeAnthropic}.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
public abstract class ApiTestBase {

    private static final EmbeddedPostgres POSTGRES = startPostgres();
    protected static final FakeAnthropic ANTHROPIC = FakeAnthropic.start();

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newHttpClient();

    @Value("${local.server.port}")
    private int port;

    private static EmbeddedPostgres startPostgres() {
        try {
            return EmbeddedPostgres.builder().start();
        } catch (IOException e) {
            throw new IllegalStateException("Não foi possível subir o PostgreSQL de teste", e);
        }
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> POSTGRES.getJdbcUrl("postgres", "postgres"));
        registry.add("spring.datasource.username", () -> "postgres");
        registry.add("spring.datasource.password", () -> "postgres");
        registry.add("kronos.ai.api-key", () -> "chave-de-teste");
        registry.add("kronos.ai.base-url", ANTHROPIC::baseUrl);
    }

    // ── Chamadas HTTP ─────────────────────────────────────────────────────

    /** Resposta da API já separada em status, data e error. */
    public static final class Reply {
        public final int status;
        public final String body;
        public final Object data;
        public final Map<String, Object> error;

        @SuppressWarnings("unchecked")
        Reply(int status, String body) {
            this.status = status;
            this.body = body;
            Map<String, Object> json = Map.of();
            try {
                if (body.startsWith("{")) json = JSON.readValue(body, Map.class);
            } catch (IOException notJson) {
                // Corpo que não é JSON (ex: streaming): fica só em body
            }
            this.data = json.get("data");
            this.error = (Map<String, Object>) json.get("error");
        }

        @SuppressWarnings("unchecked")
        public List<Map<String, Object>> rows() {
            return data == null ? List.of() : (List<Map<String, Object>>) data;
        }

        @SuppressWarnings("unchecked")
        public Map<String, Object> map() {
            return (Map<String, Object>) data;
        }

        public String errorCode() {
            return error == null ? null : (String) error.get("code");
        }
    }

    protected Reply post(String path, String token, Object body) {
        try {
            HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(url(path)))
                .header("Content-Type", "application/json; charset=utf-8")
                .POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body), StandardCharsets.UTF_8));
            if (token != null) request.header("Authorization", "Bearer " + token);
            HttpResponse<String> response = HTTP.send(request.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            return new Reply(response.statusCode(), response.body());
        } catch (IOException | InterruptedException e) {
            throw new IllegalStateException(e);
        }
    }

    protected HttpResponse<byte[]> upload(String path, String token, String contentType, byte[] bytes) {
        try {
            HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(url(path)))
                .header("Content-Type", contentType)
                .POST(HttpRequest.BodyPublishers.ofByteArray(bytes));
            if (token != null) request.header("Authorization", "Bearer " + token);
            return HTTP.send(request.build(), HttpResponse.BodyHandlers.ofByteArray());
        } catch (IOException | InterruptedException e) {
            throw new IllegalStateException(e);
        }
    }

    protected HttpResponse<byte[]> download(String path) {
        try {
            return HTTP.send(HttpRequest.newBuilder(URI.create(url(path))).GET().build(),
                HttpResponse.BodyHandlers.ofByteArray());
        } catch (IOException | InterruptedException e) {
            throw new IllegalStateException(e);
        }
    }

    private String url(String path) {
        return "http://localhost:" + port + "/api" + path;
    }

    // ── Atalhos usados em vários testes ───────────────────────────────────

    /** Usuário recém-cadastrado, com o token da sessão */
    public static final class User {
        public final String id;
        public final String email;
        public final String token;

        User(String id, String email, String token) {
            this.id = id;
            this.email = email;
            this.token = token;
        }
    }

    protected User newUser(String name) {
        String email = name.toLowerCase() + "-" + UUID.randomUUID() + "@teste.com";
        Reply reply = post("/auth/signup", null, Map.of("email", email, "password", "segredo123", "name", name));
        if (reply.status != 200) throw new IllegalStateException("Cadastro falhou: " + reply.body);
        @SuppressWarnings("unchecked")
        Map<String, Object> user = (Map<String, Object>) reply.map().get("user");
        return new User((String) user.get("id"), email, (String) reply.map().get("access_token"));
    }

    protected Reply rpc(User user, String name, Map<String, Object> args) {
        return post("/rpc/" + name, user.token, args);
    }

    /** Monta o JSON de uma consulta do jeito que services/api.ts monta. */
    protected static Map<String, Object> query(String table, String action) {
        Map<String, Object> query = new LinkedHashMap<>();
        query.put("table", table);
        query.put("action", action);
        query.put("columns", "*");
        query.put("returning", action.equals("select"));
        query.put("filters", new ArrayList<Map<String, Object>>());
        query.put("order", new ArrayList<Map<String, Object>>());
        return query;
    }

    @SuppressWarnings("unchecked")
    protected static Map<String, Object> filter(Map<String, Object> query, String column, String op, Object value) {
        Map<String, Object> filter = new LinkedHashMap<>();
        filter.put("column", column);
        filter.put("op", op);
        filter.put("value", value);
        ((List<Map<String, Object>>) query.get("filters")).add(filter);
        return query;
    }

    protected static Map<String, Object> with(Map<String, Object> query, String key, Object value) {
        query.put(key, value);
        return query;
    }

    protected Reply select(User user, String table, String columns, Object... filters) {
        Map<String, Object> query = with(query(table, "select"), "columns", columns);
        for (int i = 0; i < filters.length; i += 3) filter(query, (String) filters[i], (String) filters[i + 1], filters[i + 2]);
        return post("/query", user.token, query);
    }

    /** Insere e devolve a linha gravada. */
    protected Map<String, Object> insert(User user, String table, Map<String, Object> values) {
        Map<String, Object> query = with(with(query(table, "insert"), "values", values), "returning", true);
        Reply reply = post("/query", user.token, query);
        if (reply.status != 200) throw new IllegalStateException("Insert falhou: " + reply.body);
        return reply.rows().get(0);
    }

    /** Squad novo do usuário; devolve o id. */
    protected String newSquad(User admin, String name) {
        return (String) rpc(admin, "create_squad", Map.of("p_name", name, "p_personal", false)).data;
    }

    protected String inviteCode(User admin, String squadId) {
        return (String) select(admin, "squads", "invite_code", "id", "eq", squadId).rows().get(0).get("invite_code");
    }

    /** Id do dia da semana (0 = Segunda) no plano do squad. */
    protected String dayId(User member, String squadId, int dayOrder) {
        return (String) select(member, "workout_days", "id", "squad_id", "eq", squadId, "day_order", "eq", dayOrder)
            .rows().get(0).get("id");
    }

    protected String newExercise(User member, String dayId, String name) {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("workout_day_id", dayId);
        values.put("name", name);
        values.put("sets", 3);
        values.put("reps", "10");
        values.put("rest", "60s");
        return (String) insert(member, "exercises", values).get("id");
    }

    /** Grava uma série do jeito que a fila offline grava (upsert). */
    protected Reply logSet(User user, String exerciseId, String date, int setIndex, Double weight, Integer reps, boolean done) {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("user_id", user.id);
        values.put("exercise_id", exerciseId);
        values.put("date", date);
        values.put("set_index", setIndex);
        values.put("weight", weight);
        values.put("reps", reps);
        values.put("done", done);
        Map<String, Object> query = with(query("set_logs", "upsert"), "values", values);
        return post("/query", user.token, with(query, "onConflict", "user_id,exercise_id,date,set_index"));
    }

    protected Reply markExercise(User user, String exerciseId, String date, boolean completed) {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("exercise_id", exerciseId);
        values.put("user_id", user.id);
        values.put("date", date);
        values.put("completed", completed);
        values.put("skipped", false);
        Map<String, Object> query = with(query("exercise_progress", "upsert"), "values", values);
        return post("/query", user.token, with(query, "onConflict", "exercise_id,user_id,date"));
    }
}
