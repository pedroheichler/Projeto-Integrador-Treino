package com.kronos.app.backend;

import android.content.Context;
import android.content.res.AssetManager;
import android.database.SQLException;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

import fi.iki.elonen.NanoHTTPD;

/**
 * Servidor HTTP do backend, rodando dentro do app em 127.0.0.1.
 *
 * Rotas:
 * <ul>
 *   <li>POST /api/auth/signup | /api/auth/login | /api/auth/logout, GET /api/auth/me</li>
 *   <li>POST /api/query — CRUD genérico (ver {@link QueryService})</li>
 *   <li>POST /api/rpc/{nome} — funções do servidor (ver {@link RpcService})</li>
 *   <li>POST /api/ai — IA (ainda não disponível no beta)</li>
 *   <li>qualquer outro caminho — arquivos do frontend (assets/www)</li>
 * </ul>
 */
public class ApiServer extends NanoHTTPD {

    private static final String TAG = "KronosApi";
    public static final int DEFAULT_PORT = 8765;

    private final AssetManager assets;
    private final AuthService auth;
    private final QueryService queries;
    private final RpcService rpc;

    private ApiServer(int port, Context context, Database database) {
        super("127.0.0.1", port);
        this.assets = context.getAssets();
        this.auth = new AuthService(database);
        this.queries = new QueryService(database);
        this.rpc = new RpcService(database);
    }

    /** Sobe o servidor na porta padrão; se ela estiver ocupada, usa qualquer porta livre. */
    public static ApiServer start(Context context, Database database) throws IOException {
        try {
            ApiServer server = new ApiServer(DEFAULT_PORT, context, database);
            server.start(SOCKET_READ_TIMEOUT, true);
            return server;
        } catch (IOException portInUse) {
            Log.w(TAG, "Porta " + DEFAULT_PORT + " ocupada, usando uma porta livre", portInUse);
            ApiServer server = new ApiServer(0, context, database);
            server.start(SOCKET_READ_TIMEOUT, true);
            return server;
        }
    }

    public String baseUrl() {
        return "http://127.0.0.1:" + getListeningPort() + "/";
    }

    @Override
    public Response serve(IHTTPSession session) {
        String uri = session.getUri();
        if (uri.startsWith("/api/")) return api(session, uri.substring("/api".length()));
        return asset(uri);
    }

    // ── API ───────────────────────────────────────────────────────────────

    private Response api(IHTTPSession session, String path) {
        try {
            JSONObject body = readBody(session);
            String token = bearerToken(session);
            Object data;

            switch (path) {
                case "/auth/signup":
                    data = auth.signUp(body);
                    break;
                case "/auth/login":
                    data = auth.login(body);
                    break;
                case "/auth/logout":
                    auth.logout(token);
                    data = JSONObject.NULL;
                    break;
                case "/auth/me":
                    data = auth.me(requireUser(token));
                    break;
                case "/query":
                    data = queries.execute(requireUser(token), body);
                    break;
                case "/ai":
                    requireUser(token);
                    throw new ApiException(503, "A IA ainda não está disponível na versão beta.");
                default:
                    if (path.startsWith("/rpc/")) {
                        data = rpc.call(path.substring("/rpc/".length()), requireUser(token), body);
                        break;
                    }
                    throw new ApiException(404, "Rota não encontrada: " + path);
            }

            JSONObject out = new JSONObject();
            out.put("data", data == null ? JSONObject.NULL : data);
            return json(200, out);
        } catch (ApiException e) {
            return error(e.status, e.getMessage(), e.code);
        } catch (SQLException e) {
            // Ex: violação de UNIQUE/NOT NULL
            Log.w(TAG, "Erro de banco em " + path, e);
            return error(400, "Não foi possível gravar: " + e.getMessage(), "db_error");
        } catch (JSONException e) {
            return error(400, "JSON inválido: " + e.getMessage(), "bad_json");
        } catch (Exception e) {
            Log.e(TAG, "Erro inesperado em " + path, e);
            return error(500, "Erro interno no servidor.", "internal");
        }
    }

    private String requireUser(String token) throws ApiException {
        String userId = auth.userIdForToken(token);
        if (userId == null) throw new ApiException(401, "Sessão expirada. Entre novamente.", "unauthorized");
        return userId;
    }

    private static String bearerToken(IHTTPSession session) {
        String header = session.getHeaders().get("authorization");
        if (header == null || !header.startsWith("Bearer ")) return null;
        return header.substring("Bearer ".length()).trim();
    }

    /** Lê o corpo como UTF-8 (o parseBody do NanoHTTPD estraga acentos). */
    private static JSONObject readBody(IHTTPSession session) throws IOException, JSONException {
        String length = session.getHeaders().get("content-length");
        int size = length == null ? 0 : Integer.parseInt(length.trim());
        if (size <= 0) return new JSONObject();

        byte[] buffer = new byte[size];
        InputStream in = session.getInputStream();
        int read = 0;
        while (read < size) {
            int n = in.read(buffer, read, size - read);
            if (n < 0) break;
            read += n;
        }
        String text = new String(buffer, 0, read, StandardCharsets.UTF_8).trim();
        return text.isEmpty() ? new JSONObject() : new JSONObject(text);
    }

    private static Response error(int status, String message, String code) {
        try {
            JSONObject error = new JSONObject();
            error.put("message", message);
            if (code != null) error.put("code", code);
            JSONObject out = new JSONObject();
            out.put("error", error);
            return json(status, out);
        } catch (JSONException e) {
            return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, MIME_PLAINTEXT, message);
        }
    }

    private static Response json(int status, JSONObject body) {
        Response response = newFixedLengthResponse(status(status), "application/json; charset=utf-8", body.toString());
        response.addHeader("Cache-Control", "no-store");
        return response;
    }

    private static Response.IStatus status(int code) {
        for (Response.Status status : Response.Status.values()) {
            if (status.getRequestStatus() == code) return status;
        }
        return Response.Status.INTERNAL_ERROR;
    }

    // ── Frontend ──────────────────────────────────────────────────────────

    private static final Map<String, String> MIME = new HashMap<>();

    static {
        MIME.put("html", "text/html; charset=utf-8");
        MIME.put("js", "text/javascript; charset=utf-8");
        MIME.put("css", "text/css; charset=utf-8");
        MIME.put("json", "application/json");
        MIME.put("webmanifest", "application/manifest+json");
        MIME.put("png", "image/png");
        MIME.put("svg", "image/svg+xml");
        MIME.put("ico", "image/x-icon");
        MIME.put("woff2", "font/woff2");
    }

    private Response asset(String uri) {
        String path = uri.equals("/") ? "index.html" : uri.substring(1);
        if (path.contains("..")) return newFixedLengthResponse(Response.Status.FORBIDDEN, MIME_PLAINTEXT, "");

        try {
            Response response = newChunkedResponse(Response.Status.OK, mime(path), assets.open("www/" + path));
            // Os arquivos de assets/ têm hash no nome; o index.html não pode ficar em cache
            response.addHeader("Cache-Control", path.equals("index.html") ? "no-cache" : "max-age=31536000");
            return response;
        } catch (IOException missing) {
            if (!path.equals("index.html")) return newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "");
            return newFixedLengthResponse(Response.Status.OK, "text/html; charset=utf-8",
                "<body style='background:#0B0F1A;color:#E6EAF2;font-family:sans-serif;padding:24px'>" +
                "<h3>Frontend não encontrado</h3><p>Rode <code>npm run build:android</code> e instale o app de novo.</p>");
        }
    }

    private static String mime(String path) {
        int dot = path.lastIndexOf('.');
        String type = dot < 0 ? null : MIME.get(path.substring(dot + 1));
        return type != null ? type : "application/octet-stream";
    }
}
