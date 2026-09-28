package com.kronos.app;

import android.app.Application;
import android.util.Log;

import com.kronos.app.backend.ApiServer;
import com.kronos.app.backend.Database;

import java.io.IOException;

/**
 * Sobe o backend uma vez por processo, antes de qualquer tela.
 * Assim girar a tela ou recriar a Activity não reinicia o servidor.
 */
public class KronosApplication extends Application {

    private static ApiServer server;

    @Override
    public void onCreate() {
        super.onCreate();
        try {
            server = ApiServer.start(this, new Database(this));
            Log.i("Kronos", "Backend em " + server.baseUrl());
        } catch (IOException e) {
            Log.e("Kronos", "Não foi possível iniciar o backend", e);
        }
    }

    /** Endereço do backend, ou null se ele não subiu. */
    public static String baseUrl() {
        return server != null ? server.baseUrl() : null;
    }
}
