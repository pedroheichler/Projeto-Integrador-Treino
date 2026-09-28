package com.kronos.app.backend;

/** Erro que vira resposta HTTP com {"error": {"message", "code"}}. */
public class ApiException extends Exception {

    public final int status;
    public final String code;

    public ApiException(int status, String message) {
        this(status, message, null);
    }

    public ApiException(int status, String message, String code) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
