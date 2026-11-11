package com.kronos.server;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.springframework.boot.SpringApplication;

import java.io.File;

/**
 * Sobe o servidor para desenvolvimento sem precisar instalar o PostgreSQL:
 * {@code ./gradlew bootTestRun}. O banco fica em build/dev-postgres e é
 * mantido entre uma execução e outra.
 *
 * Em produção o servidor roda pela classe {@link KronosServerApplication},
 * apontando para um PostgreSQL de verdade.
 */
public class DevServer {

    public static void main(String[] args) throws Exception {
        EmbeddedPostgres postgres = EmbeddedPostgres.builder()
            .setDataDirectory(new File("build/dev-postgres"))
            .setCleanDataDirectory(false)
            .start();

        System.setProperty("spring.datasource.url", postgres.getJdbcUrl("postgres", "postgres"));
        System.setProperty("spring.datasource.username", "postgres");
        System.setProperty("spring.datasource.password", "postgres");

        // KRONOS_FAKE_AI=1 troca a API da Anthropic por respostas prontas, para
        // experimentar as telas de IA sem chave e sem gastar créditos
        if (System.getenv("KRONOS_FAKE_AI") != null) {
            System.setProperty("kronos.ai.api-key", "chave-falsa");
            System.setProperty("kronos.ai.base-url", FakeAnthropic.start().baseUrl());
        }

        SpringApplication.run(KronosServerApplication.class, args);
    }
}
