package com.kronos.server.web;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.LinkedHashMap;
import java.util.Map;

/** Transforma exceções em {"error": {"message", "code"}}, o formato que a interface lê. */
@RestControllerAdvice
public class ErrorHandler {

    private static final Logger log = LoggerFactory.getLogger(ErrorHandler.class);

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<Map<String, Object>> api(ApiException e) {
        return error(e.status, e.getMessage(), e.code);
    }

    /** Ex: violação de UNIQUE, NOT NULL ou chave estrangeira. O detalhe fica só no log. */
    @ExceptionHandler(DataAccessException.class)
    public ResponseEntity<Map<String, Object>> database(DataAccessException e) {
        log.warn("Erro de banco: {}", e.getMostSpecificCause().getMessage());
        return error(400, "Não foi possível gravar os dados.", "db_error");
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<Map<String, Object>> badJson(HttpMessageNotReadableException e) {
        return error(400, "JSON inválido.", "bad_json");
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> unexpected(Exception e) throws Exception {
        // Erros do próprio Spring (404, método não permitido...) seguem o tratamento padrão
        if (e instanceof org.springframework.web.ErrorResponse) throw e;
        log.error("Erro inesperado", e);
        return error(500, "Erro interno no servidor.", "internal");
    }

    private static ResponseEntity<Map<String, Object>> error(int status, String message, String code) {
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("message", message);
        if (code != null) detail.put("code", code);
        return ResponseEntity.status(status).body(Map.of("error", detail));
    }
}
