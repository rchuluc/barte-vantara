# syntax=docker/dockerfile:1.7
FROM eclipse-temurin:25-jdk-alpine@sha256:c7c3d0bdf7f2bbc5a05a6712ed334d198360105634ea9adf76fca94f381b1e3f AS build
WORKDIR /build
COPY gradlew .
COPY gradle gradle
COPY build.gradle.kts settings.gradle.kts ./
RUN --mount=type=cache,target=/root/.gradle ./gradlew dependencies --no-daemon
COPY src src
RUN --mount=type=cache,target=/root/.gradle ./gradlew bootJar --no-daemon

FROM eclipse-temurin:25-jre-alpine@sha256:e1898fd6a11fc965a994d8ace186fd3585aeb636cf8f05f47a723fcfee0b0918 AS runtime
RUN apk add --no-cache curl && addgroup -g 10001 app && adduser -D -u 10001 -G app app \
    && mkdir /auth && chown 10001:10001 /auth
WORKDIR /app
COPY --from=build --chown=10001:10001 /build/build/libs/app.jar app.jar
USER 10001:10001
VOLUME ["/tmp"]
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=65 -XX:+ExitOnOutOfMemoryError"
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=3s --start-period=90s --retries=3 CMD ["curl", "--fail", "--silent", "http://localhost:8080/api/health"]
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
