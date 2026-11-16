package com.kronos.server.data;

import org.springframework.jdbc.core.RowMapper;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** Utilitários compartilhados pelos serviços. */
public final class Rows {

    private Rows() {}

    /** Mesmo formato do JavaScript (new Date().toISOString()) */
    private static final DateTimeFormatter ISO_MILLIS =
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

    /** Converte cada linha em um mapa pronto para virar JSON. */
    public static final RowMapper<Map<String, Object>> MAPPER = (rs, rowNumber) -> read(rs);

    public static String newId() {
        return UUID.randomUUID().toString();
    }

    public static String iso(Instant instant) {
        return ISO_MILLIS.format(instant);
    }

    /** Datas saem como "YYYY-MM-DD" e horários em ISO-8601 (UTC), como a interface espera. */
    private static Map<String, Object> read(ResultSet rs) throws SQLException {
        ResultSetMetaData meta = rs.getMetaData();
        Map<String, Object> row = new LinkedHashMap<>();

        for (int i = 1; i <= meta.getColumnCount(); i++) {
            Object value;
            switch (meta.getColumnTypeName(i)) {
                case "date": {
                    LocalDate date = rs.getObject(i, LocalDate.class);
                    value = date == null ? null : date.toString();
                    break;
                }
                case "timestamptz": {
                    OffsetDateTime time = rs.getObject(i, OffsetDateTime.class);
                    value = time == null ? null : iso(time.toInstant());
                    break;
                }
                default:
                    value = rs.getObject(i);
                    if (value instanceof BigDecimal) value = ((BigDecimal) value).doubleValue();
            }
            row.put(meta.getColumnLabel(i), value);
        }
        return row;
    }

    public static String placeholders(int count) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < count; i++) sb.append(i == 0 ? "?" : ",?");
        return sb.toString();
    }
}
