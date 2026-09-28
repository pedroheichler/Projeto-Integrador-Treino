package com.kronos.app.backend;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * CRUD genérico sobre as tabelas do app. O frontend manda a consulta como JSON:
 *
 * <pre>
 * { "table": "exercises", "action": "select", "columns": "id, name",
 *   "filters": [{"column": "workout_day_id", "op": "eq", "value": "..."}],
 *   "order": [{"column": "created_at", "ascending": true}], "limit": 10 }
 * </pre>
 *
 * Segurança: tabela e colunas são validadas contra o esquema real (nada do
 * cliente entra no SQL sem passar por essa lista) e os valores vão sempre
 * como parâmetros. Nas tabelas com dono (user_id), escritas só valem para
 * as linhas do próprio usuário.
 */
public class QueryService {

    /** Tabelas expostas para a API (users e auth_sessions ficam de fora) */
    private static final Set<String> TABLES = new HashSet<>(Arrays.asList(
        "profiles", "squads", "squad_members", "workout_days", "exercises",
        "exercise_progress", "set_logs", "workout_sessions", "tracked_exercises",
        "exercise_loads", "water_intake", "diet_settings", "meal_slots", "meals",
        "favorite_meals", "body_weight", "body_measurements"
    ));

    private final Database database;
    private final Map<String, TableInfo> tables = new HashMap<>();

    /** Colunas de uma tabela, lidas do próprio SQLite */
    static final class TableInfo {
        final String name;
        final Set<String> columns = new LinkedHashSet<>();
        final Set<String> booleans = new HashSet<>();
        final List<String> primaryKey = new ArrayList<>();

        TableInfo(String name) {
            this.name = name;
        }

        /** Coluna que identifica o dono da linha, se houver */
        String ownerColumn() {
            if (name.equals("profiles")) return "id";
            return columns.contains("user_id") ? "user_id" : null;
        }
    }

    public QueryService(Database database) {
        this.database = database;
    }

    public JSONArray execute(String userId, JSONObject query) throws ApiException, JSONException {
        TableInfo table = table(query.optString("table"));
        String action = query.optString("action", "select");

        switch (action) {
            case "select":
                return select(table, query);
            case "insert":
                return insert(table, userId, query);
            case "upsert":
                return upsert(table, userId, query);
            case "update":
                return update(table, userId, query);
            case "delete":
                delete(table, userId, query);
                return new JSONArray();
            default:
                throw new ApiException(400, "Ação inválida: " + action);
        }
    }

    // ── Leitura ───────────────────────────────────────────────────────────

    private JSONArray select(TableInfo table, JSONObject query) throws ApiException, JSONException {
        Where where = where(table, query.optJSONArray("filters"));
        return selectWhere(table, query.optString("columns", "*"), where,
            orderBy(table, query.optJSONArray("order")), query.optInt("limit", 0));
    }

    private JSONArray selectWhere(TableInfo table, String columnSpec, Where where, String orderBy, int limit)
            throws ApiException, JSONException {
        Columns columns = parseColumns(table, columnSpec);

        StringBuilder sql = new StringBuilder("SELECT ").append(columns.sql())
            .append(" FROM ").append(table.name).append(where.sql);
        if (!orderBy.isEmpty()) sql.append(orderBy);
        if (limit > 0) sql.append(" LIMIT ").append(limit);

        SQLiteDatabase db = database.getReadableDatabase();
        JSONArray rows = Rows.read(db.rawQuery(sql.toString(), where.argsArray()), table.booleans);
        for (Relation relation : columns.relations) embed(db, rows, relation);
        return rows;
    }

    /**
     * Relações embutidas no select: "exercise_id, exercises(name)" traz o
     * exercício junto de cada linha, seguindo a coluna exercise_id.
     */
    private void embed(SQLiteDatabase db, JSONArray rows, Relation relation) throws ApiException, JSONException {
        Set<String> ids = new LinkedHashSet<>();
        for (int i = 0; i < rows.length(); i++) {
            Object id = rows.getJSONObject(i).opt(relation.foreignKey);
            if (id != null && id != JSONObject.NULL) ids.add(id.toString());
        }

        Map<String, JSONObject> byId = new HashMap<>();
        if (!ids.isEmpty()) {
            Columns columns = parseColumns(relation.table, relation.columns);
            String sql = "SELECT id AS __id, " + columns.sql() + " FROM " + relation.table.name +
                " WHERE id IN (" + Rows.placeholders(ids.size()) + ")";
            JSONArray related = Rows.read(db.rawQuery(sql, ids.toArray(new String[0])), relation.table.booleans);
            for (int i = 0; i < related.length(); i++) {
                JSONObject row = related.getJSONObject(i);
                byId.put(row.getString("__id"), row);
                row.remove("__id");
            }
        }

        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            JSONObject match = byId.get(row.optString(relation.foreignKey));
            row.put(relation.table.name, match != null ? match : JSONObject.NULL);
        }
    }

    // ── Escrita ───────────────────────────────────────────────────────────

    private JSONArray insert(TableInfo table, String userId, JSONObject query) throws ApiException, JSONException {
        List<Long> rowIds = new ArrayList<>();
        SQLiteDatabase db = database.getWritableDatabase();

        synchronized (database) {
            db.beginTransaction();
            try {
                for (JSONObject row : rowsOf(query.opt("values"))) {
                    ContentValues values = values(table, row, userId);
                    ensureId(table, values);
                    rowIds.add(db.insertOrThrow(table.name, null, values));
                }
                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }
        }
        return returning(table, query, rowIds);
    }

    /** Insere ou atualiza, usando as colunas de onConflict (ou a chave primária) para achar a linha. */
    private JSONArray upsert(TableInfo table, String userId, JSONObject query) throws ApiException, JSONException {
        List<String> conflict = new ArrayList<>();
        String onConflict = query.optString("onConflict", "");
        if (!onConflict.isEmpty()) {
            for (String column : onConflict.split(",")) conflict.add(column(table, column.trim()));
        } else {
            conflict.addAll(table.primaryKey);
        }

        List<Long> rowIds = new ArrayList<>();
        SQLiteDatabase db = database.getWritableDatabase();

        synchronized (database) {
            db.beginTransaction();
            try {
                for (JSONObject row : rowsOf(query.opt("values"))) {
                    ContentValues values = values(table, row, userId);
                    Long existing = findByConflict(db, table, conflict, values);
                    if (existing != null) {
                        db.update(table.name, values, "rowid = ?", new String[]{existing.toString()});
                        rowIds.add(existing);
                    } else {
                        ensureId(table, values);
                        rowIds.add(db.insertOrThrow(table.name, null, values));
                    }
                }
                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }
        }
        return returning(table, query, rowIds);
    }

    private JSONArray update(TableInfo table, String userId, JSONObject query) throws ApiException, JSONException {
        Where where = scopedWhere(table, userId, query);
        Object raw = query.opt("values");
        if (!(raw instanceof JSONObject)) throw new ApiException(400, "update precisa de um objeto de valores.");
        ContentValues values = values(table, (JSONObject) raw, null);
        // Não deixa transferir a linha para outro dono
        String owner = table.ownerColumn();
        if (owner != null) values.remove(owner);

        List<Long> rowIds = new ArrayList<>();
        SQLiteDatabase db = database.getWritableDatabase();

        synchronized (database) {
            db.beginTransaction();
            try {
                try (Cursor c = db.rawQuery("SELECT rowid FROM " + table.name + where.sql, where.argsArray())) {
                    while (c.moveToNext()) rowIds.add(c.getLong(0));
                }
                if (!rowIds.isEmpty() && values.size() > 0) {
                    db.update(table.name, values,
                        "rowid IN (" + Rows.placeholders(rowIds.size()) + ")", toArgs(rowIds));
                }
                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }
        }
        return returning(table, query, rowIds);
    }

    private void delete(TableInfo table, String userId, JSONObject query) throws ApiException, JSONException {
        Where where = scopedWhere(table, userId, query);
        synchronized (database) {
            database.getWritableDatabase().delete(table.name, where.sql.substring(" WHERE ".length()), where.argsArray());
        }
    }

    /** Filtros do cliente + "só as linhas do usuário" nas tabelas com dono. */
    private Where scopedWhere(TableInfo table, String userId, JSONObject query) throws ApiException, JSONException {
        JSONArray filters = query.optJSONArray("filters");
        if (filters == null || filters.length() == 0) {
            throw new ApiException(400, "update/delete sem filtro não é permitido.");
        }
        Where where = where(table, filters);
        String owner = table.ownerColumn();
        if (owner != null) where.and("\"" + owner + "\" = ?", userId);
        return where;
    }

    /** Devolve as linhas gravadas quando o cliente pediu .select() depois da escrita. */
    private JSONArray returning(TableInfo table, JSONObject query, List<Long> rowIds)
            throws ApiException, JSONException {
        if (!query.optBoolean("returning") || rowIds.isEmpty()) return new JSONArray();
        Where where = new Where();
        where.and("rowid IN (" + Rows.placeholders(rowIds.size()) + ")", (Object[]) toArgs(rowIds));
        return selectWhere(table, query.optString("columns", "*"), where, " ORDER BY rowid", 0);
    }

    private Long findByConflict(SQLiteDatabase db, TableInfo table, List<String> conflict, ContentValues values) {
        if (conflict.isEmpty()) return null;
        Where where = new Where();
        for (String column : conflict) {
            Object value = values.get(column);
            if (value == null) return null; // sem a chave completa não há como existir
            where.and("\"" + column + "\" = ?", value);
        }
        try (Cursor c = db.rawQuery("SELECT rowid FROM " + table.name + where.sql + " LIMIT 1", where.argsArray())) {
            return c.moveToFirst() ? c.getLong(0) : null;
        }
    }

    /** Gera o id (UUID) quando a tabela usa id texto e o cliente não mandou. */
    private static void ensureId(TableInfo table, ContentValues values) {
        if (table.primaryKey.size() == 1 && table.primaryKey.get(0).equals("id") && !values.containsKey("id")) {
            values.put("id", Rows.newId());
        }
    }

    private ContentValues values(TableInfo table, JSONObject row, String forcedOwner) throws ApiException {
        ContentValues values = new ContentValues();
        Iterator<String> keys = row.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            String column = column(table, key);
            Object value = row.opt(key);

            if (value == null || value == JSONObject.NULL) values.putNull(column);
            else if (value instanceof Boolean) values.put(column, ((Boolean) value) ? 1 : 0);
            else if (value instanceof Integer || value instanceof Long) values.put(column, ((Number) value).longValue());
            else if (value instanceof Number) values.put(column, ((Number) value).doubleValue());
            else values.put(column, value.toString());
        }
        // Linha sempre pertence a quem está logado, não importa o que o cliente mandou
        String owner = table.ownerColumn();
        if (forcedOwner != null && owner != null) values.put(owner, forcedOwner);
        return values;
    }

    private static List<JSONObject> rowsOf(Object raw) throws ApiException, JSONException {
        List<JSONObject> rows = new ArrayList<>();
        if (raw instanceof JSONObject) {
            rows.add((JSONObject) raw);
        } else if (raw instanceof JSONArray) {
            JSONArray array = (JSONArray) raw;
            for (int i = 0; i < array.length(); i++) rows.add(array.getJSONObject(i));
        } else {
            throw new ApiException(400, "Nenhum valor para gravar.");
        }
        return rows;
    }

    // ── Filtros, ordem e colunas ──────────────────────────────────────────

    /** Cláusula WHERE montada aos poucos, com os parâmetros na mesma ordem. */
    static final class Where {
        String sql = "";
        final List<String> args = new ArrayList<>();

        void and(String condition, Object... values) {
            sql += (sql.isEmpty() ? " WHERE " : " AND ") + condition;
            for (Object value : values) args.add(Rows.arg(value));
        }

        String[] argsArray() {
            return args.toArray(new String[0]);
        }
    }

    private Where where(TableInfo table, JSONArray filters) throws ApiException, JSONException {
        Where where = new Where();
        if (filters == null) return where;

        for (int i = 0; i < filters.length(); i++) {
            JSONObject filter = filters.getJSONObject(i);
            String column = "\"" + column(table, filter.optString("column")) + "\"";
            String op = filter.optString("op");
            Object value = filter.opt("value");
            boolean isNull = value == null || value == JSONObject.NULL;

            switch (op) {
                case "eq":
                    if (isNull) where.and(column + " IS NULL");
                    else where.and(column + " = ?", value);
                    break;
                case "neq":
                case "not.eq":
                    if (isNull) where.and(column + " IS NOT NULL");
                    else where.and(column + " <> ?", value);
                    break;
                case "gt":  where.and(column + " > ?", value); break;
                case "gte": where.and(column + " >= ?", value); break;
                case "lt":  where.and(column + " < ?", value); break;
                case "lte": where.and(column + " <= ?", value); break;
                case "in":
                case "not.in": {
                    JSONArray list = value instanceof JSONArray ? (JSONArray) value : new JSONArray();
                    if (list.length() == 0) {
                        // IN () vazio: nada casa (ou tudo, no NOT IN)
                        where.and(op.equals("in") ? "0" : "1");
                        break;
                    }
                    Object[] items = new Object[list.length()];
                    for (int j = 0; j < list.length(); j++) items[j] = list.get(j);
                    where.and(column + (op.equals("in") ? " IN (" : " NOT IN (") +
                        Rows.placeholders(items.length) + ")", items);
                    break;
                }
                case "is":
                    if (isNull) where.and(column + " IS NULL");
                    else where.and(column + " = ?", value);
                    break;
                case "not.is":
                    if (isNull) where.and(column + " IS NOT NULL");
                    else where.and(column + " <> ?", value);
                    break;
                default:
                    throw new ApiException(400, "Filtro não suportado: " + op);
            }
        }
        return where;
    }

    private String orderBy(TableInfo table, JSONArray order) throws ApiException, JSONException {
        if (order == null || order.length() == 0) return "";
        StringBuilder sql = new StringBuilder(" ORDER BY ");
        for (int i = 0; i < order.length(); i++) {
            JSONObject item = order.getJSONObject(i);
            if (i > 0) sql.append(", ");
            sql.append('"').append(column(table, item.optString("column"))).append('"')
                .append(item.optBoolean("ascending", true) ? " ASC" : " DESC");
        }
        return sql.toString();
    }

    /** Relação pedida no select, ex: squads(is_personal) */
    static final class Relation {
        TableInfo table;
        String foreignKey;
        String columns;
    }

    static final class Columns {
        final List<String> plain = new ArrayList<>();
        final List<Relation> relations = new ArrayList<>();
        boolean all;

        String sql() {
            if (all) return "*";
            StringBuilder sb = new StringBuilder();
            for (String column : plain) {
                if (sb.length() > 0) sb.append(", ");
                sb.append('"').append(column).append('"');
            }
            return sb.length() == 0 ? "rowid AS __rowid" : sb.toString();
        }
    }

    private Columns parseColumns(TableInfo table, String spec) throws ApiException {
        Columns columns = new Columns();
        for (String item : splitTopLevel(spec)) {
            item = item.trim();
            if (item.isEmpty()) continue;

            int paren = item.indexOf('(');
            if (paren > 0 && item.endsWith(")")) {
                Relation relation = new Relation();
                relation.table = table(item.substring(0, paren).trim());
                relation.columns = item.substring(paren + 1, item.length() - 1);
                // squads -> squad_id, exercises -> exercise_id
                String singular = relation.table.name.replaceAll("s$", "");
                relation.foreignKey = column(table, singular + "_id");
                columns.relations.add(relation);
                if (!columns.plain.contains(relation.foreignKey)) columns.plain.add(relation.foreignKey);
            } else if (item.equals("*")) {
                columns.all = true;
            } else {
                String column = column(table, item);
                if (!columns.plain.contains(column)) columns.plain.add(column);
            }
        }
        if (columns.plain.isEmpty() && columns.relations.isEmpty()) columns.all = true;
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

    private static String column(TableInfo table, String name) throws ApiException {
        if (!table.columns.contains(name)) {
            throw new ApiException(400, "Coluna desconhecida: " + table.name + "." + name);
        }
        return name;
    }

    private TableInfo table(String name) throws ApiException {
        if (!TABLES.contains(name)) throw new ApiException(400, "Tabela desconhecida: " + name);
        synchronized (tables) {
            TableInfo info = tables.get(name);
            if (info != null) return info;

            info = new TableInfo(name);
            try (Cursor c = database.getReadableDatabase().rawQuery("PRAGMA table_info(" + name + ")", null)) {
                while (c.moveToNext()) {
                    String column = c.getString(c.getColumnIndexOrThrow("name"));
                    info.columns.add(column);
                    if ("BOOLEAN".equalsIgnoreCase(c.getString(c.getColumnIndexOrThrow("type")))) {
                        info.booleans.add(column);
                    }
                    if (c.getInt(c.getColumnIndexOrThrow("pk")) > 0) info.primaryKey.add(column);
                }
            }
            tables.put(name, info);
            return info;
        }
    }

    private static String[] toArgs(List<Long> ids) {
        String[] args = new String[ids.size()];
        for (int i = 0; i < ids.size(); i++) args[i] = ids.get(i).toString();
        return args;
    }
}
