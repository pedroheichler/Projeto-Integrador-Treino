package com.kronos.server.data;

import com.kronos.server.web.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Tabelas que a API expõe e os tipos das suas colunas, lidos do próprio banco.
 * Nada que vem do cliente entra no SQL sem passar por aqui: nome de tabela e
 * de coluna são conferidos e cada valor é convertido para o tipo da coluna.
 */
@Component
public class Schema {

    /** Tabelas expostas para a API (users, auth_sessions e files ficam de fora) */
    private static final Set<String> TABLES = Set.of(
        "profiles", "squads", "squad_members", "workout_days", "exercises",
        "exercise_progress", "set_logs", "workout_sessions", "tracked_exercises",
        "exercise_loads", "water_intake", "diet_settings", "meal_slots", "meals",
        "favorite_meals", "body_weight", "body_measurements"
    );

    public enum Kind { TEXT, INT, LONG, DOUBLE, BOOL, DATE, TIMESTAMP }

    public static final class Table {
        public final String name;
        public final Map<String, Kind> columns = new LinkedHashMap<>();
        public String primaryKey;

        Table(String name) {
            this.name = name;
        }

        /** Coluna que identifica o dono da linha, se houver */
        public String ownerColumn() {
            if (name.equals("profiles")) return "id";
            return columns.containsKey("user_id") ? "user_id" : null;
        }

        /** Confere que a coluna existe e devolve o tipo dela. */
        public Kind kind(String column) {
            Kind kind = columns.get(column);
            if (kind == null) throw new ApiException(400, "Coluna desconhecida: " + name + "." + column);
            return kind;
        }
    }

    private final JdbcTemplate jdbc;
    private final Map<String, Table> cache = new ConcurrentHashMap<>();

    public Schema(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Table table(String name) {
        if (name == null || !TABLES.contains(name)) throw new ApiException(400, "Tabela desconhecida: " + name);
        return cache.computeIfAbsent(name, this::load);
    }

    private Table load(String name) {
        Table table = new Table(name);
        jdbc.query(
            "SELECT column_name, udt_name FROM information_schema.columns " +
            "WHERE table_schema = current_schema() AND table_name = ? ORDER BY ordinal_position",
            rs -> { table.columns.put(rs.getString(1), kindOf(rs.getString(2))); },
            name);
        table.primaryKey = jdbc.queryForObject(
            "SELECT a.attname FROM pg_index i " +
            "JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey) " +
            "WHERE i.indrelid = ?::regclass AND i.indisprimary",
            String.class, name);
        return table;
    }

    private static Kind kindOf(String type) {
        switch (type) {
            case "int2":
            case "int4":
                return Kind.INT;
            case "int8":
                return Kind.LONG;
            case "float4":
            case "float8":
            case "numeric":
                return Kind.DOUBLE;
            case "bool":
                return Kind.BOOL;
            case "date":
                return Kind.DATE;
            case "timestamptz":
                return Kind.TIMESTAMP;
            default:
                return Kind.TEXT;
        }
    }

    /** Converte um valor vindo do JSON para o tipo da coluna (ou responde 400). */
    public static Object convert(Table table, String column, Object value) {
        Kind kind = table.kind(column);
        if (value == null) return null;
        try {
            switch (kind) {
                case TEXT:
                    return value.toString();
                case INT:
                case LONG: {
                    BigDecimal number = number(value);
                    if (number == null) return null;
                    long rounded = Math.round(number.doubleValue());
                    return kind == Kind.INT ? (Object) Math.toIntExact(rounded) : (Object) rounded;
                }
                case DOUBLE: {
                    BigDecimal number = number(value);
                    return number == null ? null : number.doubleValue();
                }
                case BOOL:
                    if (value instanceof Boolean) return value;
                    if (value instanceof Number) return ((Number) value).doubleValue() != 0;
                    return Set.of("true", "1", "t").contains(value.toString().trim().toLowerCase());
                case DATE: {
                    String text = value.toString().trim();
                    return LocalDate.parse(text.length() > 10 ? text.substring(0, 10) : text);
                }
                default:
                    return OffsetDateTime.parse(value.toString().trim());
            }
        } catch (RuntimeException invalid) {
            throw new ApiException(400, "Valor inválido para " + table.name + "." + column + ".");
        }
    }

    private static BigDecimal number(Object value) {
        if (value instanceof Boolean) return ((Boolean) value) ? BigDecimal.ONE : BigDecimal.ZERO;
        if (value instanceof Number) return new BigDecimal(value.toString());
        String text = value.toString().trim().replace(',', '.');
        return text.isEmpty() ? null : new BigDecimal(text);
    }
}
