package com.kronos.server;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

import java.net.URI;

/** Servidor do Kronos: a mesma API do backend embutido no app, sobre PostgreSQL. */
@SpringBootApplication
public class KronosServerApplication {

    public static void main(String[] args) {
        useDatabaseUrlIfPresent();
        SpringApplication.run(KronosServerApplication.class, args);
    }

    /**
     * Hospedagens como Render e Railway entregam o banco numa variável só,
     * DATABASE_URL=postgres://usuario:senha@host:porta/banco. O Spring espera
     * a URL no formato JDBC, então convertemos aqui (se KRONOS_DB_URL não foi
     * definida à mão).
     */
    static void useDatabaseUrlIfPresent() {
        String url = System.getenv("DATABASE_URL");
        if (url == null || System.getenv("KRONOS_DB_URL") != null) return;
        if (!url.startsWith("postgres://") && !url.startsWith("postgresql://")) return;

        URI uri = URI.create(url);
        String port = uri.getPort() > 0 ? ":" + uri.getPort() : "";
        System.setProperty("spring.datasource.url", "jdbc:postgresql://" + uri.getHost() + port + uri.getPath());

        String userInfo = uri.getUserInfo();
        if (userInfo != null) {
            int colon = userInfo.indexOf(':');
            System.setProperty("spring.datasource.username", colon < 0 ? userInfo : userInfo.substring(0, colon));
            if (colon >= 0) System.setProperty("spring.datasource.password", userInfo.substring(colon + 1));
        }
    }
}
