package com.kronos.server;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * Faz o papel da API da Anthropic nos testes: responde a POST /v1/messages no
 * mesmo formato da API real (JSON ou eventos SSE) e guarda o último pedido
 * recebido. Assim a rota /api/ai é testada de ponta a ponta sem chave e sem
 * gastar créditos.
 */
public final class FakeAnthropic {

    private static final ObjectMapper JSON = new ObjectMapper();

    private final HttpServer server;
    private volatile Map<String, Object> lastRequest;
    private volatile String lastApiKey;

    private FakeAnthropic(HttpServer server) {
        this.server = server;
    }

    static FakeAnthropic start() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            FakeAnthropic fake = new FakeAnthropic(server);
            server.createContext("/v1/messages", fake::handle);
            server.start();
            return fake;
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    String baseUrl() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    /** Corpo do último pedido que o servidor mandou para a "Anthropic" */
    public Map<String, Object> lastRequest() {
        return lastRequest;
    }

    public String lastApiKey() {
        return lastApiKey;
    }

    @SuppressWarnings("unchecked")
    private void handle(HttpExchange exchange) throws IOException {
        lastRequest = JSON.readValue(exchange.getRequestBody().readAllBytes(), Map.class);
        // O SDK manda a chave em x-api-key ou em Authorization: Bearer, conforme a versão
        String key = exchange.getRequestHeaders().getFirst("x-api-key");
        String authorization = exchange.getRequestHeaders().getFirst("Authorization");
        if (key == null && authorization != null) key = authorization.replaceFirst("^Bearer ", "");
        lastApiKey = key;

        boolean stream = Boolean.TRUE.equals(lastRequest.get("stream"));
        byte[] body = (stream ? STREAM : MESSAGE).getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", stream ? "text/event-stream" : "application/json");
        exchange.sendResponseHeaders(200, body.length);
        exchange.getResponseBody().write(body);
        exchange.close();
    }

    private static final String MESSAGE = """
        {"id":"msg_teste","type":"message","role":"assistant","model":"claude-opus-5-5",
         "content":[{"type":"text","text":"{\\"name\\":\\"Arroz e feijão\\",\\"calories\\":350}"}],
         "stop_reason":"end_turn","stop_sequence":null,
         "usage":{"input_tokens":20,"output_tokens":12}}
        """;

    /** Um texto curto seguido da chamada da ferramenta create_workout_day */
    private static final String STREAM = String.join("\n\n",
        event("message_start", """
            {"type":"message_start","message":{"id":"msg_teste","type":"message","role":"assistant",\
            "model":"claude-opus-5-5","content":[],"stop_reason":null,"stop_sequence":null,\
            "usage":{"input_tokens":20,"output_tokens":1}}}"""),
        event("content_block_start", """
            {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"""),
        event("content_block_delta", """
            {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Montei um treino "}}"""),
        event("content_block_delta", """
            {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"de peito."}}"""),
        event("content_block_stop", """
            {"type":"content_block_stop","index":0}"""),
        event("content_block_start", """
            {"type":"content_block_start","index":1,"content_block":\
            {"type":"tool_use","id":"toolu_teste","name":"create_workout_day","input":{}}}"""),
        event("content_block_delta", """
            {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta",\
            "partial_json":"{\\"day_name\\":\\"Segunda\\",\\"focus\\":\\"Peito\\","}}"""),
        event("content_block_delta", """
            {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta",\
            "partial_json":"\\"exercises\\":[{\\"name\\":\\"Supino reto\\",\\"sets\\":4,\\"reps\\":\\"8-10\\",\
            \\"rest\\":\\"90s\\",\\"notes\\":\\"\\"}]}"}}"""),
        event("content_block_stop", """
            {"type":"content_block_stop","index":1}"""),
        event("message_delta", """
            {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},\
            "usage":{"output_tokens":40}}"""),
        event("message_stop", """
            {"type":"message_stop"}""")) + "\n\n";

    private static String event(String name, String data) {
        return "event: " + name + "\ndata: " + data.strip();
    }
}
