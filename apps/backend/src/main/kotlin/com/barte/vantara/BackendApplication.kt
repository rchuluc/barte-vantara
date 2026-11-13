package com.barte.vantara

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

@SpringBootApplication
class BackendApplication

fun main(args: Array<String>) {
    val context = runApplication<BackendApplication>(*args)
    if (context.environment.activeProfiles.contains("migrate")) context.close()
}
