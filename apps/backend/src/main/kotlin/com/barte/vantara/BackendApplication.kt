package com.barte.vantara

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

@SpringBootApplication
class BackendApplication

fun main(args: Array<String>) {
    val context = runApplication<BackendApplication>(*args)
    val profiles = context.environment.activeProfiles
    if ("migrate" in profiles || "seed" in profiles) context.close()
}
