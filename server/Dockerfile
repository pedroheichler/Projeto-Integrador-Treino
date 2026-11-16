# ── Compila o servidor ──
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app
COPY gradlew settings.gradle build.gradle ./
COPY gradle gradle
RUN chmod +x gradlew && ./gradlew --no-daemon dependencies > /dev/null
COPY src src
RUN ./gradlew --no-daemon bootJar

# ── Imagem final: só o Java e o jar ──
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/build/libs/kronos-server-*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
