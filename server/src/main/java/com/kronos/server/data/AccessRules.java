package com.kronos.server.data;

import com.kronos.server.data.Schema.Table;
import com.kronos.server.web.ApiException;

import java.util.List;
import java.util.Set;

/**
 * Quem pode ler e gravar o quê. No app o banco era de um aparelho só; no
 * servidor ele é de todo mundo, então cada consulta ganha um filtro extra:
 *
 * <ul>
 *   <li>dados pessoais (dieta, peso, séries, progresso...): só o dono;</li>
 *   <li>squad, dias e exercícios: só quem é membro do squad;</li>
 *   <li>perfil: o próprio e o de quem divide um squad com o usuário;</li>
 *   <li>nome e ícone do squad: só o admin (RN04).</li>
 * </ul>
 */
final class AccessRules {

    private AccessRules() {}

    /** Pedaço de SQL para o WHERE, com os parâmetros na mesma ordem. */
    static final class Condition {
        final String sql;
        final List<Object> args;

        Condition(String sql, Object... args) {
            this.sql = sql;
            this.args = List.of(args);
        }
    }

    private static final String MY_SQUADS = "(SELECT squad_id FROM squad_members WHERE user_id = ?)";
    private static final String MY_DAYS =
        "(SELECT d.id FROM workout_days d JOIN squad_members m ON m.squad_id = d.squad_id WHERE m.user_id = ?)";
    static final String SQUADS_I_ADMIN =
        "(SELECT squad_id FROM squad_members WHERE user_id = ? AND role = 'admin')";

    /**
     * Squads e membros só mudam pelas funções do RpcService (create_squad,
     * join_squad_by_code, remove_squad_member...), que conferem o papel de
     * quem pediu. Por aqui o membro só consegue sair do squad e o admin só
     * edita nome e ícone.
     */
    static void checkAction(Table table, String action) {
        boolean allowed;
        switch (table.name) {
            case "squads":
            case "workout_days":
                allowed = action.equals("select") || action.equals("update");
                break;
            case "squad_members":
                allowed = action.equals("select") || action.equals("delete");
                break;
            default:
                // upsert depende de saber quem é o dono da linha
                allowed = !action.equals("upsert") || table.ownerColumn() != null;
        }
        if (!allowed) throw new ApiException(403, "Operação não permitida em " + table.name + ".", "nao_permitido");
    }

    /** Linhas que o usuário pode ver. */
    static Condition readScope(Table table, String userId) {
        switch (table.name) {
            case "profiles":
                return new Condition(
                    "(\"id\" = ? OR \"id\" IN (SELECT other.user_id FROM squad_members mine " +
                    "JOIN squad_members other ON other.squad_id = mine.squad_id WHERE mine.user_id = ?))",
                    userId, userId);
            case "squads":
                return new Condition("\"id\" IN " + MY_SQUADS, userId);
            case "squad_members":
            case "workout_days":
                return new Condition("\"squad_id\" IN " + MY_SQUADS, userId);
            case "exercises":
                return new Condition("\"workout_day_id\" IN " + MY_DAYS, userId);
            default:
                return new Condition("\"user_id\" = ?", userId);
        }
    }

    /** Linhas que o usuário pode alterar ou apagar. */
    static Condition writeScope(Table table, String userId) {
        switch (table.name) {
            case "profiles":
                return new Condition("\"id\" = ?", userId);
            case "squads":
                return new Condition("\"id\" IN " + SQUADS_I_ADMIN, userId);
            case "squad_members":
                return new Condition("\"user_id\" = ?", userId);
            default:
                return readScope(table, userId);
        }
    }

    /** Colunas que um update pode mudar; null = todas menos dono e chave. */
    static Set<String> updatableColumns(Table table) {
        switch (table.name) {
            case "squads":
                // RN04: o código de convite só muda por regenerate/revoke_invite_code
                return Set.of("name", "icon");
            case "workout_days":
                return Set.of("name", "focus", "day_order");
            default:
                return null;
        }
    }

    static String dayInMySquads() {
        return "SELECT COUNT(*) FROM workout_days d JOIN squad_members m ON m.squad_id = d.squad_id " +
            "WHERE d.id = ? AND m.user_id = ?";
    }
}
