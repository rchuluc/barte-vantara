package com.barte.vantara

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.ApplicationListener
import org.springframework.context.ConfigurableApplicationContext
import org.springframework.context.annotation.Bean
import org.testcontainers.postgresql.PostgreSQLContainer
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse

class BootstrapTests {
    @Test
    fun `migration entrypoint closes after migrating and runtime entrypoint serves the migrated database`() {
        PostgreSQLContainer("postgres:17-alpine").use { postgres ->
            postgres.start()
            val common =
                arrayOf(
                    "--spring.datasource.url=${postgres.jdbcUrl}",
                    "--spring.main.sources=${Probe::class.java.name}",
                )

            main(
                common +
                    arrayOf(
                        "--spring.profiles.active=migrate",
                        "--spring.datasource.username=${postgres.username}",
                        "--spring.datasource.password=${postgres.password}",
                        "--APP_DB_PASSWORD=testRuntimePassword",
                    ),
            )
            assertFalse(context.isActive, "Migration must close its application context before returning")

            try {
                main(
                    common +
                        arrayOf(
                            "--server.port=0",
                            "--spring.datasource.username=app_user",
                            "--spring.datasource.password=testRuntimePassword",
                        ),
                )
                assertTrue(context.isActive, "Runtime must remain active to serve requests")
                val port = context.environment.getRequiredProperty("local.server.port")
                val response =
                    HttpClient.newHttpClient().send(
                        HttpRequest.newBuilder(URI("http://localhost:$port/api/hello")).build(),
                        HttpResponse.BodyHandlers.ofString(),
                    )
                assertEquals(200, response.statusCode())
                assertTrue(response.body().contains("Hello world from Kotlin and PostgreSQL"))
            } finally {
                context.close()
            }
        }
    }

    @TestConfiguration(proxyBeanMethods = false)
    class Probe {
        @Bean
        fun readyListener(): ApplicationListener<ApplicationReadyEvent> =
            ApplicationListener { event -> context = event.applicationContext }
    }

    companion object {
        private lateinit var context: ConfigurableApplicationContext
    }
}
