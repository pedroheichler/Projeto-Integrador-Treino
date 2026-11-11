package com.kronos.app.backend;

import android.content.Context;
import android.content.res.AssetManager;
import android.database.Cursor;
import android.database.SQLException;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
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
 *   <li>POST e GET /api/files/{bucket}/{dono}/{nome} — fotos de perfil e de squad</li>
 *   <li>POST /api/ai — IA: só funciona com o servidor do Kronos, onde fica a chave</li>
 *   <li>qualquer outro caminho — arquivos do frontend (assets/www)</li>
 * </ul>
 */
public class ApiServer extends NanoHTTPD {

    private static final String TAG = "KronosApi";
    public static final int DEFAULT_PORT = 8765;

    private static final int MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

    private final AssetManager assets;
    private final File uploads;
    private final Database database;
    private final AuthService auth;
    private final QueryService queries;
    private final RpcService rpc;

    private ApiServer(int port, Context context, Database database) {
        super("127.0.0.1", port);
        this.assets = context.getAssets();
        this.uploads = new File(context.getFilesDir(), "uploads");
        this.database = database;
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
        if (uri.startsWith("/api/files/")) return files(session, uri.substring("/api/files/".length()));
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
                    throw new ApiException(503,
                        "A IA funciona quando o app está ligado ao servidor do Kronos.", "ia_desligada");
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

    // ── Fotos ─────────────────────────────────────────────────────────────

    /**
     * Fotos de perfil (avatars/{id do usuário}/avatar) e de squad
     * (squad-icons/{id do squad}/icon), guardadas na pasta de arquivos do app.
     * Ver é livre (a tag img não manda o token); enviar exige ser o dono da
     * foto ou o admin do squad.
     */
    private Response files(IHTTPSession session, String path) {
        try {
            String[] parts = path.split("/");
            if (parts.length != 3) throw new ApiException(404, "Arquivo não encontrado.");
            for (String part : parts) {
                // Só letras, números e hífen: nada de ".." para sair da pasta
                if (!part.matches("[A-Za-z0-9-]+")) throw new ApiException(404, "Arquivo não encontrado.");
            }
            File file = new File(new File(new File(uploads, parts[0]), parts[1]), parts[2]);

            if (session.getMethod() == Method.GET) {
                if (!file.isFile()) throw new ApiException(404, "Arquivo não encontrado.");
                byte[] head = new byte[12];
                int read;
                try (InputStream in = new FileInputStream(file)) {
                    read = in.read(head);
                }
                Response response = newFixedLengthResponse(
                    Response.Status.OK, imageType(head, read), new FileInputStream(file), file.length());
                response.addHeader("Cache-Control", "max-age=3600");
                response.addHeader("X-Content-Type-Options", "nosniff");
                return response;
            }

            String userId = requireUser(bearerToken(session));
            checkUploadPermission(userId, parts[0], parts[1], parts[2]);

            byte[] data = readBytes(session);
            if (data.length == 0) throw new ApiException(400, "Arquivo vazio.");
            // O tipo vem do conteúdo, não do que o cliente declarou
            if (imageType(data, data.length) == null) throw new ApiException(400, "Use uma imagem JPG, PNG ou WebP.");

            File folder = file.getParentFile();
            if (folder == null || (!folder.isDirectory() && !folder.mkdirs())) {
                throw new IOException("Não foi possível criar a pasta de fotos");
            }
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(data);
            }

            JSONObject out = new JSONObject();
            out.put("data", JSONObject.NULL);
            return json(200, out);
        } catch (ApiException e) {
            return error(e.status, e.getMessage(), e.code);
        } catch (Exception e) {
            Log.e(TAG, "Erro inesperado em /files/" + path, e);
            return error(500, "Erro interno no servidor.", "internal");
        }
    }

    private void checkUploadPermission(String userId, String bucket, String owner, String name) throws ApiException {
        boolean allowed;
        if (bucket.equals("avatars") && name.equals("avatar")) {
            allowed = owner.equals(userId);
        } else if (bucket.equals("squad-icons") && name.equals("icon")) {
            // RN04: só o admin troca a foto do squad
            try (Cursor c = database.getReadableDatabase().rawQuery(
                    "SELECT 1 FROM squad_members WHERE squad_id = ? AND user_id = ? AND role = 'admin'",
                    new String[]{owner, userId})) {
                allowed = c.moveToFirst();
            }
        } else {
            throw new ApiException(404, "Destino de arquivo desconhecido.");
        }
        if (!allowed) throw new ApiException(403, "Você não pode trocar essa imagem.", "nao_permitido");
    }

    private static byte[] readBytes(IHTTPSession session) throws IOException, ApiException {
        String length = session.getHeaders().get("content-length");
        int size = length == null ? 0 : Integer.parseInt(length.trim());
        if (size > MAX_UPLOAD_BYTES) throw new ApiException(413, "A imagem deve ter no máximo 5 MB.");

        byte[] buffer = new byte[Math.max(size, 0)];
        InputStream in = session.getInputStream();
        int read = 0;
        while (read < buffer.length) {
            int n = in.read(buffer, read, buffer.length - read);
            if (n < 0) break;
            read += n;
        }
        return read == buffer.length ? buffer : Arrays.copyOf(buffer, read);
    }

    /** Reconhece JPG, PNG e WebP pelos primeiros bytes; null se não for imagem. */
    private static String imageType(byte[] data, int length) {
        if (length >= 3 && (data[0] & 0xFF) == 0xFF && (data[1] & 0xFF) == 0xD8 && (data[2] & 0xFF) == 0xFF) {
            return "image/jpeg";
        }
        if (length >= 4 && (data[0] & 0xFF) == 0x89 && data[1] == 'P' && data[2] == 'N' && data[3] == 'G') {
            return "image/png";
        }
        if (length >= 12 && data[0] == 'R' && data[1] == 'I' && data[2] == 'F' && data[3] == 'F'
                && data[8] == 'W' && data[9] == 'E' && data[10] == 'B' && data[11] == 'P') {
            return "image/webp";
        }
        return null;
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
