package com.kronos.server.web;

import com.anthropic.core.http.StreamResponse;
import com.anthropic.models.messages.RawMessageStreamEvent;
import com.kronos.server.ai.AiService;
import com.kronos.server.auth.AuthService;
import com.kronos.server.data.QueryService;
import com.kronos.server.files.FileService;
import com.kronos.server.rules.RpcService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.io.IOException;
import java.io.InputStream;
import java.time.Duration;
import java.util.Collections;
import java.util.Map;

/**
 * Rotas da API, as mesmas do backend embutido no app Android:
 *
 * <ul>
 *   <li>POST /api/auth/signup | /api/auth/login | /api/auth/logout, GET /api/auth/me</li>
 *   <li>POST /api/query — CRUD genérico (ver {@link QueryService})</li>
 *   <li>POST /api/rpc/{nome} — regras de negócio (ver {@link RpcService})</li>
 *   <li>POST /api/ai — Kronos IA (ver {@link AiService})</li>
 *   <li>POST e GET /api/files/{bucket}/{dono}/{nome} — fotos (ver {@link FileService})</li>
 * </ul>
 *
 * Toda resposta de sucesso é {"data": ...}; erros são {"error": {"message", "code"}}.
 */
@RestController
@RequestMapping("/api")
public class ApiController {

    private final AuthService auth;
    private final QueryService queries;
    private final RpcService rpc;
    private final AiService ai;
    private final FileService files;

    public ApiController(AuthService auth, QueryService queries, RpcService rpc, AiService ai, FileService files) {
        this.auth = auth;
        this.queries = queries;
        this.rpc = rpc;
        this.ai = ai;
        this.files = files;
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return data("ok");
    }

    // ── Conta ─────────────────────────────────────────────────────────────

    @PostMapping("/auth/signup")
    public Map<String, Object> signUp(@RequestBody(required = false) Map<String, Object> body) {
        return data(auth.signUp(orEmpty(body)));
    }

    @PostMapping("/auth/login")
    public Map<String, Object> login(@RequestBody(required = false) Map<String, Object> body) {
        return data(auth.login(orEmpty(body)));
    }

    @PostMapping("/auth/logout")
    public Map<String, Object> logout(@RequestHeader(value = "Authorization", required = false) String authorization) {
        auth.logout(bearerToken(authorization));
        return data(null);
    }

    @RequestMapping(value = "/auth/me", method = {RequestMethod.GET, RequestMethod.POST})
    public Map<String, Object> me(@RequestHeader(value = "Authorization", required = false) String authorization) {
        return data(auth.me(requireUser(authorization)));
    }

    // ── Dados e regras ────────────────────────────────────────────────────

    @PostMapping("/query")
    public Map<String, Object> query(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestBody(required = false) Map<String, Object> body) {
        return data(queries.execute(requireUser(authorization), orEmpty(body)));
    }

    @PostMapping("/rpc/{name}")
    public Map<String, Object> rpc(
            @PathVariable String name,
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestBody(required = false) Map<String, Object> body) {
        return data(rpc.call(name, requireUser(authorization), orEmpty(body)));
    }

    // ── IA ────────────────────────────────────────────────────────────────

    /**
     * A conversa de treino responde em streaming (text/event-stream); as
     * outras operações devolvem o JSON da resposta direto, sem o {"data"}.
     */
    @PostMapping("/ai")
    public Object ai(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestBody(required = false) Map<String, Object> body,
            HttpServletResponse response) {
        String userId = requireUser(authorization);
        Object operation = orEmpty(body).get("operation");
        Object request = orEmpty(body).get("request");
        if (!(operation instanceof String) || !(request instanceof Map)) {
            throw new ApiException(400, "Pedido de IA inválido.");
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> aiRequest = (Map<String, Object>) request;

        if (!operation.equals("workout-chat")) {
            return ai.complete(userId, (String) operation, aiRequest);
        }

        StreamResponse<RawMessageStreamEvent> stream = ai.openChat(userId, aiRequest);
        response.setContentType(MediaType.TEXT_EVENT_STREAM_VALUE);
        response.setCharacterEncoding("UTF-8");
        response.setHeader("Cache-Control", "no-store");
        // Sem isso, proxies como o nginx seguram a resposta até ela terminar
        response.setHeader("X-Accel-Buffering", "no");
        StreamingResponseBody responseBody = out -> ai.pipeChat(stream, out);
        return responseBody;
    }

    // ── Arquivos ──────────────────────────────────────────────────────────

    @PostMapping("/files/{bucket}/{owner}/{name}")
    public Map<String, Object> upload(
            @PathVariable String bucket, @PathVariable String owner, @PathVariable String name,
            @RequestHeader(value = "Authorization", required = false) String authorization,
            HttpServletRequest request) throws IOException {
        String userId = requireUser(authorization);

        // Lê no máximo o limite + 1 byte: não carrega um arquivo gigante na memória
        byte[] bytes;
        try (InputStream in = request.getInputStream()) {
            bytes = in.readNBytes(FileService.MAX_BYTES + 1);
        }
        files.upload(userId, bucket, owner, name, bytes);
        return data(null);
    }

    /** Público de propósito: a tag &lt;img&gt; não manda o token de login. */
    @GetMapping("/files/{bucket}/{owner}/{name}")
    public ResponseEntity<byte[]> download(
            @PathVariable String bucket, @PathVariable String owner, @PathVariable String name) {
        FileService.StoredFile file = files.read(bucket, owner, name);
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(file.contentType))
            .cacheControl(CacheControl.maxAge(Duration.ofHours(1)).cachePublic())
            .header("X-Content-Type-Options", "nosniff")
            .body(file.data);
    }

    // ── Apoio ─────────────────────────────────────────────────────────────

    private String requireUser(String authorization) {
        String userId = auth.userIdForToken(bearerToken(authorization));
        if (userId == null) throw new ApiException(401, "Sessão expirada. Entre novamente.", "unauthorized");
        return userId;
    }

    private static String bearerToken(String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ")) return null;
        return authorization.substring("Bearer ".length()).trim();
    }

    private static Map<String, Object> orEmpty(Map<String, Object> body) {
        return body == null ? Map.of() : body;
    }

    private static Map<String, Object> data(Object value) {
        return Collections.singletonMap("data", value);
    }
}
