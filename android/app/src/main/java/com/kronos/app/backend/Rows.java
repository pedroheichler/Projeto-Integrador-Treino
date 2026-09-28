package com.kronos.app.backend;

import android.database.Cursor;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.time.Instant;
import java.util.Collections;
import java.util.Set;
import java.util.UUID;

/** Utilitários compartilhados pelos serviços. */
final class Rows {

    private Rows() {}

    static String newId() {
        return UUID.randomUUID().toString();
    }

    static String now() {
        return Instant.now().toString();
    }

    static JSONArray read(Cursor cursor) throws JSONException {
        return read(cursor, Collections.emptySet());
    }

    /** Converte o resultado de uma consulta em JSON; colunas booleanas saem como true/false. */
    static JSONArray read(Cursor cursor, Set<String> booleans) throws JSONException {
        JSONArray out = new JSONArray();
        try {
            while (cursor.moveToNext()) {
                JSONObject row = new JSONObject();
                for (int i = 0; i < cursor.getColumnCount(); i++) {
                    String name = cursor.getColumnName(i);
                    switch (cursor.getType(i)) {
                        case Cursor.FIELD_TYPE_NULL:
                            row.put(name, JSONObject.NULL);
                            break;
                        case Cursor.FIELD_TYPE_INTEGER:
                            long value = cursor.getLong(i);
                            if (booleans.contains(name)) row.put(name, value != 0);
                            else row.put(name, value);
                            break;
                        case Cursor.FIELD_TYPE_FLOAT:
                            row.put(name, cursor.getDouble(i));
                            break;
                        default:
                            row.put(name, cursor.getString(i));
                    }
                }
                out.put(row);
            }
        } finally {
            cursor.close();
        }
        return out;
    }

    /** Valor JSON como texto para usar em rawQuery (null continua null). */
    static String arg(Object value) {
        if (value == null || value == JSONObject.NULL) return null;
        if (value instanceof Boolean) return ((Boolean) value) ? "1" : "0";
        return value.toString();
    }

    static String placeholders(int count) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < count; i++) sb.append(i == 0 ? "?" : ",?");
        return sb.toString();
    }
}
