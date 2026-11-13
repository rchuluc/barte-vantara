package com.barte.vantara

import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

@RestController
class GreetingController(
    private val jdbc: JdbcTemplate,
) {
    @GetMapping("/api/hello")
    fun hello(): Map<String, String> =
        mapOf("message" to jdbc.queryForObject("SELECT message FROM greetings WHERE id = 1", String::class.java)!!)
}
