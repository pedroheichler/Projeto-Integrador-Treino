package com.kronos.server;

import org.junit.jupiter.api.Test;

import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;

/** Envio de fotos de perfil e de squad. */
class FilesTest extends ApiTestBase {

    /** Começo de um PNG de verdade: basta para o servidor reconhecer o tipo */
    private static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 'I', 'H', 'D', 'R'};
    private static final byte[] JPEG = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0, 0, 16, 'J', 'F', 'I', 'F'};

    @Test
    void usuarioTrocaAPropriaFotoEQualquerUmConsegueVer() {
        User ana = newUser("Ana");
        String path = "/files/avatars/" + ana.id + "/avatar";

        assertEquals(200, upload(path, ana.token, "image/png", PNG).statusCode());

        HttpResponse<byte[]> image = download(path);
        assertEquals(200, image.statusCode());
        assertEquals("image/png", image.headers().firstValue("Content-Type").orElse(""));
        assertArrayEquals(PNG, image.body());

        // Enviar de novo substitui (o tipo vem do conteúdo, não do cabeçalho)
        assertEquals(200, upload(path, ana.token, "image/png", JPEG).statusCode());
        assertEquals("image/jpeg", download(path).headers().firstValue("Content-Type").orElse(""));
    }

    @Test
    void ninguemTrocaAFotoDeOutraPessoa() {
        User ana = newUser("Ana");
        User bruno = newUser("Bruno");
        String path = "/files/avatars/" + ana.id + "/avatar";

        assertEquals(403, upload(path, bruno.token, "image/png", PNG).statusCode());
        assertEquals(401, upload(path, null, "image/png", PNG).statusCode());
        assertEquals(404, download(path).statusCode());
    }

    @Test
    void soAdminTrocaAFotoDoSquad() {
        User ana = newUser("Ana");
        User bruno = newUser("Bruno");
        String squad = newSquad(ana, "Squad");
        rpc(bruno, "join_squad_by_code", Map.of("p_code", inviteCode(ana, squad)));
        String path = "/files/squad-icons/" + squad + "/icon";

        assertEquals(403, upload(path, bruno.token, "image/png", PNG).statusCode());
        assertEquals(200, upload(path, ana.token, "image/png", PNG).statusCode());
        assertEquals(200, download(path).statusCode());
    }

    @Test
    void arquivoQueNaoEImagemOuGrandeDemaisERecusado() {
        User ana = newUser("Ana");
        String path = "/files/avatars/" + ana.id + "/avatar";

        byte[] script = "<script>alert(1)</script>".getBytes(StandardCharsets.UTF_8);
        assertEquals(400, upload(path, ana.token, "image/png", script).statusCode());
        assertEquals(400, upload(path, ana.token, "image/png", new byte[0]).statusCode());

        byte[] huge = new byte[5 * 1024 * 1024 + 10];
        System.arraycopy(PNG, 0, huge, 0, PNG.length);
        assertEquals(413, upload(path, ana.token, "image/png", huge).statusCode());

        assertEquals(404, upload("/files/outro-lugar/" + ana.id + "/avatar", ana.token, "image/png", PNG).statusCode());
    }
}
