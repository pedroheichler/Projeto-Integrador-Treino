package com.kronos.server.auth;

import com.kronos.server.data.Rows;
import com.kronos.server.web.ApiException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Cadastro, login e sessões.
 *
 * Senhas nunca são guardadas: fica só o hash PBKDF2 com um salt aleatório por
 * usuário. A sessão é um token aleatório que a interface manda no cabeçalho
 * Authorization: Bearer <token>; no banco fica só o SHA-256 dele.
 */
@Service
public class AuthService {

    private static final int ITERATIONS = 60_000;
    private static final int KEY_BITS = 256;
    private static final Duration SESSION_LIFETIME = Duration.ofDays(90);

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final SecureRandom random = new SecureRandom();

    public AuthService(JdbcTemplate jdbc, TransactionTemplate transaction) {
        this.jdbc = jdbc;
        this.transaction = transaction;
    }

    public Map<String, Object> signUp(Map<String, Object> body) {
        String email = normalizeEmail(body.get("email"));
        String password = text(body.get("password"));
        String name = text(body.get("name")).trim();

        if (!email.contains("@")) throw new ApiException(400, "Informe um e-mail válido.");
        if (password.length() < 6) throw new ApiException(400, "A senha precisa ter pelo menos 6 caracteres.");

        String userId = Rows.newId();
        String salt = hex(randomBytes(16));
        String passwordHash = hash(password, salt);
        String displayName = name.isEmpty() ? email.substring(0, email.indexOf('@')) : name;

        try {
            transaction.executeWithoutResult(status -> {
                jdbc.update("INSERT INTO users (id, email, salt, password_hash) VALUES (?, ?, ?, ?)",
                    userId, email, salt, passwordHash);
                jdbc.update("INSERT INTO profiles (id, name) VALUES (?, ?)", userId, displayName);
            });
        } catch (DuplicateKeyException emailTaken) {
            throw new ApiException(409, "Este e-mail já está cadastrado.", "email_em_uso");
        }
        return createSession(userId, email);
    }

    public Map<String, Object> login(Map<String, Object> body) {
        String email = normalizeEmail(body.get("email"));
        String password = text(body.get("password"));

        List<Map<String, Object>> users = jdbc.queryForList(
            "SELECT id, salt, password_hash FROM users WHERE email = ?", email);
        // Mesma mensagem para e-mail inexistente e senha errada
        if (users.isEmpty()) throw new ApiException(401, "E-mail ou senha incorretos.", "credenciais_invalidas");

        Map<String, Object> user = users.get(0);
        byte[] expected = text(user.get("password_hash")).getBytes(StandardCharsets.UTF_8);
        byte[] actual = hash(password, text(user.get("salt"))).getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(expected, actual)) {
            throw new ApiException(401, "E-mail ou senha incorretos.", "credenciais_invalidas");
        }
        return createSession(text(user.get("id")), email);
    }

    public void logout(String token) {
        if (token == null || token.isEmpty()) return;
        jdbc.update("DELETE FROM auth_sessions WHERE token_hash = ?", sha256(token));
    }

    /** Id do usuário dono do token, ou null se o token não vale (ou venceu). */
    public String userIdForToken(String token) {
        if (token == null || token.isEmpty()) return null;
        List<String> found = jdbc.queryForList(
            "SELECT user_id FROM auth_sessions WHERE token_hash = ? AND expires_at > clock_timestamp()",
            String.class, sha256(token));
        return found.isEmpty() ? null : found.get(0);
    }

    public Map<String, Object> me(String userId) {
        List<Map<String, Object>> users = jdbc.queryForList("SELECT id, email FROM users WHERE id = ?", userId);
        return users.isEmpty() ? new LinkedHashMap<>() : users.get(0);
    }

    private Map<String, Object> createSession(String userId, String email) {
        String token = hex(randomBytes(32));
        Instant expiresAt = Instant.now().plus(SESSION_LIFETIME);
        jdbc.update("INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
            sha256(token), userId, OffsetDateTime.ofInstant(expiresAt, ZoneOffset.UTC));
        // Aproveita o login para limpar as sessões vencidas desse usuário
        jdbc.update("DELETE FROM auth_sessions WHERE user_id = ? AND expires_at <= clock_timestamp()", userId);

        Map<String, Object> user = new LinkedHashMap<>();
        user.put("id", userId);
        user.put("email", email);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("access_token", token);
        out.put("expires_at", expiresAt.getEpochSecond());
        out.put("user", user);
        return out;
    }

    private static String normalizeEmail(Object email) {
        return text(email).trim().toLowerCase();
    }

    private static String text(Object value) {
        return value == null ? "" : value.toString();
    }

    private static String hash(String password, String salt) {
        try {
            PBEKeySpec spec = new PBEKeySpec(
                password.toCharArray(), salt.getBytes(StandardCharsets.UTF_8), ITERATIONS, KEY_BITS);
            SecretKeyFactory factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
            return hex(factory.generateSecret(spec).getEncoded());
        } catch (Exception e) {
            throw new IllegalStateException("PBKDF2 indisponível", e);
        }
    }

    private static String sha256(String value) {
        try {
            return hex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 indisponível", e);
        }
    }

    private byte[] randomBytes(int size) {
        byte[] bytes = new byte[size];
        random.nextBytes(bytes);
        return bytes;
    }

    private static String hex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }
}
