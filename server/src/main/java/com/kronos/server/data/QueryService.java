package com.kronos.server.data;

import com.kronos.server.data.AccessRules.Condition;
import com.kronos.server.data.Schema.Table;
import com.kronos.server.web.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * CRUD genérico sobre as tabelas do app. A interface manda a consulta como JSON:
 *
 * <pre>
 * { "table": "exercises", "action": "select", "columns": "id, name",
 *   "filters": [{"column": "workout_day_id", "op": "eq", "value": "..."}],
 *   "order": [{"column": "created_at", "ascending": true}], "limit": 10 }
 * </pre>
 *
 * Segurança: tabela e colunas são validadas contra o esquema real, os valores
 * vão sempre como parâmetros e toda consulta é limitada às linhas que o
 * usuário pode ver ou alterar ({@link AccessRules}).
 */
@Service
public class QueryService {

    private final JdbcTemplate jdbc;
    private final Schema schema;
    private final TransactionTemplate transaction;

    public QueryService(JdbcTemplate jdbc, Schema schema, TransactionTemplate transaction) {
        this.jdbc = jdbc;
        this.schema = schema;
        this.transaction = transaction;
    }

    public List<Map<String, Object>> execute(String userId, Map<String, Object> query) {
        Table table = schema.table(text(query.get("table")));
        String action = query.get("action") == null ? "select" : text(query.get("action"));

        switch (action) {
            case "select":
                AccessRules.checkAction(table, action);
                return select(table, userId, query);
            case "insert":
            case "upsert":
            case "update":
            case "delete":
                AccessRules.checkAction(table, action);
                // Tudo ou nada: várias linhas gravadas numa requisição só
                return transaction.execute(status -> write(table, action, userId, query));
            default:
                throw new ApiException(400, "Ação inválida: " + action);
        }
    }

    private List<Map<String, Object>> write(Table table, String action, String userId, Map<String, Object> query) {
        switch (action) {
            case "insert":
                return insert(table, userId, query);
            case "upsert":
                return upsert(table, userId, query);
            case "update":
                return update(table, userId, query);
            default:
                delete(table, userId, query);
                return List.of();
        }
    }

    // ── Leitura ───────────────────────────────────────────────────────────

    private List<Map<String, Object>> select(Table table, String userId, Map<String, Object> query) {
        Where where = where(table, query.get("filters"));
        where.and(AccessRules.readScope(table, userId));

        Object limit = query.get("limit");
        return selectWhere(table, userId, columnSpec(query), where,
            orderBy(table, query.get("order")), limit instanceof Number ? ((Number) limit).intValue() : 0);
    }

    private List<Map<String, Object>> selectWhere(
            Table table, String userId, String columnSpec, Where where, String orderBy, int limit) {
        Columns columns = parseColumns(table, columnSpec);
        List<Object> args = new ArrayList<>();

        StringBuilder sql = new StringBuilder("SELECT ").append(columns.sql(table, userId, args))
            .append(" FROM ").append(quote(table.name)).append(where.sql);
        args.addAll(where.args);
        sql.append(orderBy);
        if (limit > 0) sql.append(" LIMIT ").append(limit);

        List<Map<String, Object>> rows = jdbc.query(sql.toString(), Rows.MAPPER, args.toArray());
        for (Relation relation : columns.relations) embed(rows, relation, userId);
        return rows;
    }

    /**
     * Relações embutidas no select: "exercise_id, exercises(name)" traz o
     * exercício junto de cada linha, seguindo a coluna exercise_id.
     */
    private void embed(List<Map<String, Object>> rows, Relation relation, String userId) {
        Set<Object> ids = new LinkedHashSet<>();
        for (Map<String, Object> row : rows) {
            Object id = row.get(relation.foreignKey);
            if (id != null) ids.add(id);
        }

        Map<Object, Map<String, Object>> byId = new HashMap<>();
        if (!ids.isEmpty()) {
            Columns columns = parseColumns(relation.table, relation.columns);
            List<Object> args = new ArrayList<>();
            Condition scope = AccessRules.readScope(relation.table, userId);

            String sql = "SELECT \"id\" AS \"__id\", " + columns.sql(relation.table, userId, args) +
                " FROM " + quote(relation.table.name) +
                " WHERE \"id\" IN (" + Rows.placeholders(ids.size()) + ") AND " + scope.sql;
            args.addAll(ids);
            args.addAll(scope.args);

            for (Map<String, Object> related : jdbc.query(sql, Rows.MAPPER, args.toArray())) {
                byId.put(related.remove("__id"), related);
            }
        }

        for (Map<String, Object> row : rows) {
            row.put(relation.table.name, byId.get(row.get(relation.foreignKey)));
        }
    }

    // ── Escrita ───────────────────────────────────────────────────────────

    private List<Map<String, Object>> insert(Table table, String userId, Map<String, Object> query) {
        List<Object> ids = new ArrayList<>();
        for (Map<String, Object> row : rowsOf(query.get("values"))) {
            Map<String, Object> values = values(table, row, userId);
            ensureId(table, values);
            checkParent(table, values, userId);

            String sql = "INSERT INTO " + quote(table.name) + " (" + columnList(values.keySet()) + ") VALUES (" +
                Rows.placeholders(values.size()) + ") RETURNING " + quote(table.primaryKey);
            ids.add(jdbc.queryForObject(sql, String.class, values.values().toArray()));
        }
        return returning(table, userId, query, ids);
    }

    /**
     * Insere ou atualiza, usando as colunas de onConflict (ou a chave primária)
     * para achar a linha. Só vale em tabelas com dono, e nunca alcança a linha
     * de outro usuário.
     */
    private List<Map<String, Object>> upsert(Table table, String userId, Map<String, Object> query) {
        List<String> conflict = new ArrayList<>();
        String onConflict = query.get("onConflict") == null ? "" : text(query.get("onConflict"));
        if (onConflict.isBlank()) {
            conflict.add(table.primaryKey);
        } else {
            for (String column : onConflict.split(",")) {
                table.kind(column.trim());
                conflict.add(column.trim());
            }
        }
        String owner = table.ownerColumn();

        List<Object> ids = new ArrayList<>();
        for (Map<String, Object> row : rowsOf(query.get("values"))) {
            Map<String, Object> values = values(table, row, userId);

            // O que muda quando a linha já existe: só o que o cliente mandou
            List<String> updates = new ArrayList<>();
            for (String column : values.keySet()) {
                if (conflict.contains(column) || column.equals(owner) || column.equals(table.primaryKey)) continue;
                updates.add(quote(column) + " = EXCLUDED." + quote(column));
            }
            if (updates.isEmpty()) updates.add(quote(owner) + " = EXCLUDED." + quote(owner));
            ensureId(table, values);

            String sql = "INSERT INTO " + quote(table.name) + " AS t (" + columnList(values.keySet()) + ") VALUES (" +
                Rows.placeholders(values.size()) + ") ON CONFLICT (" + columnList(conflict) + ") DO UPDATE SET " +
                String.join(", ", updates) + " WHERE t." + quote(owner) + " = EXCLUDED." + quote(owner) +
                " RETURNING t." + quote(table.primaryKey);

            List<String> written = jdbc.queryForList(sql, String.class, values.values().toArray());
            if (written.isEmpty()) throw new ApiException(403, "Esse registro pertence a outro usuário.", "nao_permitido");
            ids.add(written.get(0));
        }
        return returning(table, userId, query, ids);
    }

    private List<Map<String, Object>> update(Table table, String userId, Map<String, Object> query) {
        Where where = scopedWhere(table, userId, query);
        if (!(query.get("values") instanceof Map)) {
            throw new ApiException(400, "update precisa de um objeto de valores.");
        }
        Map<String, Object> values = values(table, asMap(query.get("values")), null);

        // Não deixa transferir a linha para outro dono nem trocar a chave
        values.remove(table.ownerColumn());
        values.remove(table.primaryKey);
        Set<String> updatable = AccessRules.updatableColumns(table);
        if (updatable != null) values.keySet().retainAll(updatable);
        checkParent(table, values, userId);

        List<Object> args = new ArrayList<>();
        String sql;
        if (values.isEmpty()) {
            sql = "SELECT " + quote(table.primaryKey) + " FROM " + quote(table.name) + where.sql;
        } else {
            List<String> sets = new ArrayList<>();
            for (String column : values.keySet()) sets.add(quote(column) + " = ?");
            args.addAll(values.values());
            sql = "UPDATE " + quote(table.name) + " SET " + String.join(", ", sets) + where.sql +
                " RETURNING " + quote(table.primaryKey);
        }
        args.addAll(where.args);

        List<Object> ids = new ArrayList<>(jdbc.queryForList(sql, String.class, args.toArray()));
        return returning(table, userId, query, ids);
    }

    private void delete(Table table, String userId, Map<String, Object> query) {
        Where where = scopedWhere(table, userId, query);

        List<String> squadsLeft = table.name.equals("squad_members")
            ? jdbc.queryForList("SELECT \"squad_id\" FROM \"squad_members\"" + where.sql, String.class, where.args.toArray())
            : List.of();

        jdbc.update("DELETE FROM " + quote(table.name) + where.sql, where.args.toArray());
        for (String squadId : squadsLeft) promoteAdminIfMissing(squadId);
    }

    /** Se o admin saiu, o membro mais antigo assume: o squad nunca fica sem admin. */
    private void promoteAdminIfMissing(String squadId) {
        jdbc.update(
            "UPDATE squad_members SET role = 'admin' WHERE id = (" +
            "  SELECT id FROM squad_members WHERE squad_id = ? ORDER BY created_at LIMIT 1) " +
            "AND NOT EXISTS (SELECT 1 FROM squad_members WHERE squad_id = ? AND role = 'admin')",
            squadId, squadId);
    }

    /** Filtros do cliente + "só as linhas que o usuário pode alterar". */
    private Where scopedWhere(Table table, String userId, Map<String, Object> query) {
        Object filters = query.get("filters");
        if (!(filters instanceof List) || ((List<?>) filters).isEmpty()) {
            throw new ApiException(400, "update/delete sem filtro não é permitido.");
        }
        Where where = where(table, filters);
        where.and(AccessRules.writeScope(table, userId));
        return where;
    }

    /** Devolve as linhas gravadas, na ordem em que foram gravadas, quando o cliente pediu .select(). */
    private List<Map<String, Object>> returning(Table table, String userId, Map<String, Object> query, List<Object> ids) {
        if (!Boolean.TRUE.equals(query.get("returning")) || ids.isEmpty()) return List.of();

        String key = quote(table.primaryKey);
        Where where = new Where();
        where.and(new Condition(key + " IN (" + Rows.placeholders(ids.size()) + ")", ids.toArray()));
        where.and(AccessRules.readScope(table, userId));

        StringBuilder order = new StringBuilder(" ORDER BY CASE ").append(key);
        for (int i = 0; i < ids.size(); i++) order.append(" WHEN ? THEN ").append(i);
        order.append(" END");
        where.args.addAll(ids);

        return selectWhere(table, userId, columnSpec(query), where, order.toString(), 0);
    }

    /** Um exercício só pode ser criado (ou movido) para um dia de um squad do usuário. */
    private void checkParent(Table table, Map<String, Object> values, String userId) {
        if (!table.name.equals("exercises") || !values.containsKey("workout_day_id")) return;
        Integer found = jdbc.queryForObject(
            AccessRules.dayInMySquads(), Integer.class, values.get("workout_day_id"), userId);
        if (found == null || found == 0) {
            throw new ApiException(403, "Esse dia de treino não é de um squad seu.", "nao_permitido");
        }
    }

    /** Gera o id (UUID) quando a tabela usa id texto e o cliente não mandou. */
    private static void ensureId(Table table, Map<String, Object> values) {
        if (table.primaryKey.equals("id") && values.get("id") == null) values.put("id", Rows.newId());
    }

    private static Map<String, Object> values(Table table, Map<String, Object> row, String forcedOwner) {
        Map<String, Object> values = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : row.entrySet()) {
            values.put(entry.getKey(), Schema.convert(table, entry.getKey(), entry.getValue()));
        }
        // A linha sempre pertence a quem está logado, não importa o que o cliente mandou
        String owner = table.ownerColumn();
        if (forcedOwner != null && owner != null) values.put(owner, forcedOwner);
        return values;
    }

    private static List<Map<String, Object>> rowsOf(Object raw) {
        List<Map<String, Object>> rows = new ArrayList<>();
        if (raw instanceof Map) {
            rows.add(asMap(raw));
        } else if (raw instanceof List) {
            for (Object item : (List<?>) raw) rows.add(asMap(item));
        }
        if (rows.isEmpty()) throw new ApiException(400, "Nenhum valor para gravar.");
        return rows;
    }

    // ── Filtros, ordem e colunas ──────────────────────────────────────────

    /** Cláusula WHERE montada aos poucos, com os parâmetros na mesma ordem. */
    private static final class Where {
        String sql = "";
        final List<Object> args = new ArrayList<>();

        void and(Condition condition) {
            sql += (sql.isEmpty() ? " WHERE " : " AND ") + condition.sql;
            args.addAll(condition.args);
        }
    }

    private Where where(Table table, Object filters) {
        Where where = new Where();
        if (!(filters instanceof List)) return where;

        for (Object item : (List<?>) filters) {
            Map<String, Object> filter = asMap(item);
            String name = text(filter.get("column"));
            String column = quote(name);
            table.kind(name);
            String op = text(filter.get("op"));
            Object raw = filter.get("value");

            switch (op) {
                case "eq":
                case "is":
                    if (raw == null) where.and(new Condition(column + " IS NULL"));
                    else where.and(new Condition(column + " = ?", Schema.convert(table, name, raw)));
                    break;
                case "neq":
                case "not.eq":
                case "not.is":
                    if (raw == null) where.and(new Condition(column + " IS NOT NULL"));
                    else where.and(new Condition(column + " <> ?", Schema.convert(table, name, raw)));
                    break;
                case "gt":
                    where.and(new Condition(column + " > ?", required(table, name, raw)));
                    break;
                case "gte":
                    where.and(new Condition(column + " >= ?", required(table, name, raw)));
                    break;
                case "lt":
                    where.and(new Condition(column + " < ?", required(table, name, raw)));
                    break;
                case "lte":
                    where.and(new Condition(column + " <= ?", required(table, name, raw)));
                    break;
                case "in":
                case "not.in": {
                    List<Object> items = new ArrayList<>();
                    if (raw instanceof List) {
                        for (Object value : (List<?>) raw) {
                            if (value != null) items.add(Schema.convert(table, name, value));
                        }
                    }
                    if (items.isEmpty()) {
                        // IN () vazio: nada casa (ou tudo, no NOT IN)
                        where.and(new Condition(op.equals("in") ? "FALSE" : "TRUE"));
                        break;
                    }
                    where.and(new Condition(
                        column + (op.equals("in") ? " IN (" : " NOT IN (") + Rows.placeholders(items.size()) + ")",
                        items.toArray()));
                    break;
                }
                default:
                    throw new ApiException(400, "Filtro não suportado: " + op);
            }
        }
        return where;
    }

    private static Object required(Table table, String column, Object raw) {
        if (raw == null) throw new ApiException(400, "Filtro sem valor em " + table.name + "." + column + ".");
        return Schema.convert(table, column, raw);
    }

    private String orderBy(Table table, Object order) {
        if (!(order instanceof List) || ((List<?>) order).isEmpty()) return "";
        StringBuilder sql = new StringBuilder(" ORDER BY ");
        boolean first = true;
        for (Object raw : (List<?>) order) {
            Map<String, Object> item = asMap(raw);
            String column = text(item.get("column"));
            table.kind(column);
            if (!first) sql.append(", ");
            first = false;
            sql.append(quote(column)).append(Boolean.FALSE.equals(item.get("ascending")) ? " DESC" : " ASC");
        }
        return sql.toString();
    }

    /** Relação pedida no select, ex: squads(is_personal) */
    private static final class Relation {
        Table table;
        String foreignKey;
        String columns;
    }

    private static final class Columns {
        final List<String> plain = new ArrayList<>();
        final List<Relation> relations = new ArrayList<>();

        String sql(Table table, String userId, List<Object> args) {
            StringBuilder sb = new StringBuilder();
            for (String column : plain) {
                if (sb.length() > 0) sb.append(", ");
                if (table.name.equals("squads") && column.equals("invite_code")) {
                    // RN04: só o admin enxerga o código de convite
                    sb.append("CASE WHEN \"id\" IN ").append(AccessRules.SQUADS_I_ADMIN)
                        .append(" THEN \"invite_code\" END AS \"invite_code\"");
                    args.add(userId);
                } else {
                    sb.append(quote(column));
                }
            }
            return sb.toString();
        }
    }

    private Columns parseColumns(Table table, String spec) {
        Columns columns = new Columns();
        boolean all = false;

        for (String item : splitTopLevel(spec)) {
            item = item.trim();
            if (item.isEmpty()) continue;

            int paren = item.indexOf('(');
            if (paren > 0 && item.endsWith(")")) {
                Relation relation = new Relation();
                relation.table = schema.table(item.substring(0, paren).trim());
                relation.columns = item.substring(paren + 1, item.length() - 1);
                // squads -> squad_id, exercises -> exercise_id
                relation.foreignKey = relation.table.name.replaceAll("s$", "") + "_id";
                table.kind(relation.foreignKey);
                columns.relations.add(relation);
                if (!columns.plain.contains(relation.foreignKey)) columns.plain.add(relation.foreignKey);
            } else if (item.equals("*")) {
                all = true;
            } else {
                table.kind(item);
                if (!columns.plain.contains(item)) columns.plain.add(item);
            }
        }

        if (all || columns.plain.isEmpty()) {
            for (String column : table.columns.keySet()) {
                if (!columns.plain.contains(column)) columns.plain.add(column);
            }
        }
        return columns;
    }

    private static List<String> splitTopLevel(String spec) {
        List<String> parts = new ArrayList<>();
        int depth = 0;
        StringBuilder current = new StringBuilder();
        for (char ch : spec.toCharArray()) {
            if (ch == '(') depth++;
            if (ch == ')') depth--;
            if (ch == ',' && depth == 0) {
                parts.add(current.toString());
                current.setLength(0);
            } else {
                current.append(ch);
            }
        }
        parts.add(current.toString());
        return parts;
    }

    // ── Apoio ─────────────────────────────────────────────────────────────

    private static String columnSpec(Map<String, Object> query) {
        Object columns = query.get("columns");
        return columns == null ? "*" : columns.toString();
    }

    /** Os nomes já foram conferidos contra o esquema; as aspas evitam conflito com palavras do SQL. */
    private static String quote(String name) {
        return "\"" + name + "\"";
    }

    private static String columnList(Collection<String> columns) {
        List<String> quoted = new ArrayList<>();
        for (String column : columns) quoted.add(quote(column));
        return String.join(", ", quoted);
    }

    private static String text(Object value) {
        return value == null ? "" : value.toString();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object value) {
        if (!(value instanceof Map)) throw new ApiException(400, "JSON inválido: esperava um objeto.");
        return (Map<String, Object>) value;
    }
}
