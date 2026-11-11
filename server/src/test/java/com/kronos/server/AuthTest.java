package com.kronos.server;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/** RF01: cadastro, login e sessão. */
class AuthTest extends ApiTestBase {

    @Test
    void cadastroDevolveSessaoQueFunciona() {
        User ana = newUser("Ana");

        Reply me = post("/auth/me", ana.token, Map.of());
        assertEquals(200, me.status);
        assertEquals(ana.email, me.map().get("email"));

        // O perfil nasce junto com a conta, com o nome informado
        Reply profile = select(ana, "profiles", "name", "id", "eq", ana.id);
        assertEquals("Ana", profile.rows().get(0).get("name"));
    }

    @Test
    void emailRepetidoERecusado() {
        User ana = newUser("Ana");
        Reply again = post("/auth/signup", null, Map.of("email", ana.email.toUpperCase(), "password", "outrasenha"));
        assertEquals(409, again.status);
        assertEquals("email_em_uso", again.errorCode());
    }

    @Test
    void senhaCurtaOuEmailInvalidoSaoRecusados() {
        assertEquals(400, post("/auth/signup", null, Map.of("email", "a@teste.com", "password", "123")).status);
        assertEquals(400, post("/auth/signup", null, Map.of("email", "sem-arroba", "password", "segredo123")).status);
    }

    @Test
    void loginComSenhaCertaEErrada() {
        User ana = newUser("Ana");

        Reply ok = post("/auth/login", null, Map.of("email", ana.email, "password", "segredo123"));
        assertEquals(200, ok.status);
        assertNotNull(ok.map().get("access_token"));

        // Mesma resposta para senha errada e para e-mail que não existe
        Reply wrong = post("/auth/login", null, Map.of("email", ana.email, "password", "errada"));
        Reply unknown = post("/auth/login", null, Map.of("email", "ninguem@teste.com", "password", "segredo123"));
        assertEquals(401, wrong.status);
        assertEquals(401, unknown.status);
        assertEquals(wrong.error.get("message"), unknown.error.get("message"));
    }

    @Test
    void logoutInvalidaOToken() {
        User ana = newUser("Ana");
        assertEquals(200, post("/auth/logout", ana.token, Map.of()).status);
        assertEquals(401, post("/auth/me", ana.token, Map.of()).status);
    }

    @Test
    void semTokenNaoEntra() {
        assertEquals(401, post("/query", null, query("meals", "select")).status);
        assertEquals(401, post("/query", "token-inventado", query("meals", "select")).status);
        assertEquals(401, post("/rpc/ensure_meal_routine", null, Map.of()).status);
    }
}
