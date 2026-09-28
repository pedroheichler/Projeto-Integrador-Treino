package com.kronos.app.backend;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;

import org.json.JSONException;
import org.json.JSONObject;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.spec.KeySpec;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/**
 * Cadastro, login e sessões.
 *
 * Senhas nunca são guardadas: fica só o hash PBKDF2 com um salt aleatório por
 * usuário. A sessão é um token aleatório que o frontend manda no cabeçalho
 * Authorization: Bearer <token>.
 */
public class AuthService {

    private static final int ITERATIONS = 60_000;
    private static final int KEY_BITS = 256;

    private final Database database;
    private final SecureRandom random = new SecureRandom();

    public AuthService(Database database) {
        this.database = database;
    }

    public JSONObject signUp(JSONObject body) throws ApiException, JSONException {
        String email = normalizeEmail(body.optString("email"));
        String password = body.optString("password");
        String name = body.optString("name").trim();

        if (!email.contains("@")) throw new ApiException(400, "Informe um e-mail válido.");
        if (password.length() < 6) throw new ApiException(400, "A senha precisa ter pelo menos 6 caracteres.");

        SQLiteDatabase db = database.getWritableDatabase();
        synchronized (database) {
            if (findUserId(db, email) != null) {
                throw new ApiException(409, "Este e-mail já está cadastrado.", "email_em_uso");
            }

            String userId = Rows.newId();
            String salt = hex(randomBytes(16));

            db.beginTransaction();
            try {
                ContentValues user = new ContentValues();
                user.put("id", userId);
                user.put("email", email);
                user.put("salt", salt);
                user.put("password_hash", hash(password, salt));
                db.insertOrThrow("users", null, user);

                ContentValues profile = new ContentValues();
                profile.put("id", userId);
                profile.put("name", name.isEmpty() ? email.substring(0, email.indexOf('@')) : name);
                db.insertOrThrow("profiles", null, profile);

                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }
            return createSession(db, userId, email);
        }
    }

    public JSONObject login(JSONObject body) throws ApiException, JSONException {
        String email = normalizeEmail(body.optString("email"));
        String password = body.optString("password");

        SQLiteDatabase db = database.getReadableDatabase();
        try (Cursor c = db.rawQuery(
                "SELECT id, salt, password_hash FROM users WHERE email = ?", new String[]{email})) {
            // Mesma mensagem para e-mail inexistente e senha errada
            if (!c.moveToFirst()) throw new ApiException(401, "E-mail ou senha incorretos.");

            String userId = c.getString(0);
            byte[] expected = c.getString(2).getBytes();
            byte[] actual = hash(password, c.getString(1)).getBytes();
            if (!MessageDigest.isEqual(expected, actual)) {
                throw new ApiException(401, "E-mail ou senha incorretos.");
            }
            return createSession(database.getWritableDatabase(), userId, email);
        }
    }

    public void logout(String token) {
        if (token == null) return;
        database.getWritableDatabase().delete("auth_sessions", "token = ?", new String[]{token});
    }

    /** Id do usuário dono do token, ou null se o token não vale. */
    public String userIdForToken(String token) {
        if (token == null || token.isEmpty()) return null;
        try (Cursor c = database.getReadableDatabase().rawQuery(
                "SELECT user_id FROM auth_sessions WHERE token = ?", new String[]{token})) {
            return c.moveToFirst() ? c.getString(0) : null;
        }
    }

    public JSONObject me(String userId) throws JSONException {
        try (Cursor c = database.getReadableDatabase().rawQuery(
                "SELECT id, email FROM users WHERE id = ?", new String[]{userId})) {
            JSONObject user = new JSONObject();
            if (c.moveToFirst()) {
                user.put("id", c.getString(0));
                user.put("email", c.getString(1));
            }
            return user;
        }
    }

    private JSONObject createSession(SQLiteDatabase db, String userId, String email) throws JSONException {
        String token = hex(randomBytes(32));
        ContentValues session = new ContentValues();
        session.put("token", token);
        session.put("user_id", userId);
        db.insertOrThrow("auth_sessions", null, session);

        JSONObject user = new JSONObject();
        user.put("id", userId);
        user.put("email", email);

        JSONObject out = new JSONObject();
        out.put("access_token", token);
        out.put("user", user);
        return out;
    }

    private static String findUserId(SQLiteDatabase db, String email) {
        try (Cursor c = db.rawQuery("SELECT id FROM users WHERE email = ?", new String[]{email})) {
            return c.moveToFirst() ? c.getString(0) : null;
        }
    }

    private static String normalizeEmail(String email) {
        return email == null ? "" : email.trim().toLowerCase();
    }

    private static String hash(String password, String salt) {
        try {
            KeySpec spec = new PBEKeySpec(password.toCharArray(), salt.getBytes(), ITERATIONS, KEY_BITS);
            SecretKeyFactory factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
            return hex(factory.generateSecret(spec).getEncoded());
        } catch (Exception e) {
            throw new IllegalStateException("PBKDF2 indisponível", e);
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
