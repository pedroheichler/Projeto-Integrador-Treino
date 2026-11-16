package com.kronos.server.files;

import com.kronos.server.web.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Fotos de perfil e de squad. A interface envia para
 * /api/files/{bucket}/{dono}/{nome} e usa o mesmo endereço para exibir.
 *
 * <ul>
 *   <li>avatars/{id do usuário}/avatar: só o próprio usuário envia;</li>
 *   <li>squad-icons/{id do squad}/icon: só o admin do squad envia (RN04).</li>
 * </ul>
 */
@Service
public class FileService {

    public static final int MAX_BYTES = 5 * 1024 * 1024;

    /** Arquivo guardado, pronto para ser devolvido ao navegador */
    public static final class StoredFile {
        public final String contentType;
        public final byte[] data;

        StoredFile(String contentType, byte[] data) {
            this.contentType = contentType;
            this.data = data;
        }
    }

    private final JdbcTemplate jdbc;

    public FileService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void upload(String userId, String bucket, String owner, String name, byte[] data) {
        checkPermission(userId, bucket, owner, name);
        if (data.length == 0) throw new ApiException(400, "Arquivo vazio.");
        if (data.length > MAX_BYTES) throw new ApiException(413, "A imagem deve ter no máximo 5 MB.");

        // O tipo vem do conteúdo, não do que o cliente declarou
        String contentType = imageType(data);
        if (contentType == null) throw new ApiException(400, "Use uma imagem JPG, PNG ou WebP.");

        jdbc.update(
            "INSERT INTO files (bucket, path, content_type, data) VALUES (?, ?, ?, ?) " +
            "ON CONFLICT (bucket, path) DO UPDATE SET content_type = EXCLUDED.content_type, " +
            "data = EXCLUDED.data, updated_at = clock_timestamp()",
            bucket, owner + "/" + name, contentType, data);
    }

    public StoredFile read(String bucket, String owner, String name) {
        List<StoredFile> found = jdbc.query(
            "SELECT content_type, data FROM files WHERE bucket = ? AND path = ?",
            (rs, row) -> new StoredFile(rs.getString(1), rs.getBytes(2)),
            bucket, owner + "/" + name);
        if (found.isEmpty()) throw new ApiException(404, "Arquivo não encontrado.");
        return found.get(0);
    }

    private void checkPermission(String userId, String bucket, String owner, String name) {
        boolean allowed;
        if (bucket.equals("avatars") && name.equals("avatar")) {
            allowed = owner.equals(userId);
        } else if (bucket.equals("squad-icons") && name.equals("icon")) {
            Integer admin = jdbc.queryForObject(
                "SELECT COUNT(*) FROM squad_members WHERE squad_id = ? AND user_id = ? AND role = 'admin'",
                Integer.class, owner, userId);
            allowed = admin != null && admin > 0;
        } else {
            throw new ApiException(404, "Destino de arquivo desconhecido.");
        }
        if (!allowed) throw new ApiException(403, "Você não pode trocar essa imagem.", "nao_permitido");
    }

    /** Reconhece JPG, PNG e WebP pelos primeiros bytes. */
    static String imageType(byte[] data) {
        if (data.length >= 3 && (data[0] & 0xFF) == 0xFF && (data[1] & 0xFF) == 0xD8 && (data[2] & 0xFF) == 0xFF) {
            return "image/jpeg";
        }
        if (data.length >= 8 && (data[0] & 0xFF) == 0x89 && data[1] == 'P' && data[2] == 'N' && data[3] == 'G') {
            return "image/png";
        }
        if (data.length >= 12 && data[0] == 'R' && data[1] == 'I' && data[2] == 'F' && data[3] == 'F'
                && data[8] == 'W' && data[9] == 'E' && data[10] == 'B' && data[11] == 'P') {
            return "image/webp";
        }
        return null;
    }
}
