package com.kronos.server.web;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    /**
     * A interface roda em outra origem (dentro do app, em http://127.0.0.1, ou
     * no navegador). Liberar qualquer origem é seguro aqui porque o login vai
     * no cabeçalho Authorization, e não em cookie: um site de terceiros não
     * tem como usar a sessão de ninguém.
     */
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
            .allowedOriginPatterns("*")
            .allowedMethods("GET", "POST", "OPTIONS")
            .allowedHeaders("*")
            .maxAge(3600);
    }
}
