package ru.azmz.logistics.config

import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity
import org.springframework.security.web.SecurityFilterChain

/**
 * Каркас: доступ открыт, водитель определяется заголовком X-Driver-Id.
 *
 * Этап MVP (п.2 плана работ):
 *  * POST /auth/login {login, password, deviceId} → JWT access (короткий)
 *    + refresh (длинный, привязан к device_id);
 *  * логин в смену → запись в driver_shift;
 *  * офлайн: Room работает без токена, токен нужен только сетевым вызовам;
 *    2–8 часов без связи покрываются запасом жизни refresh-токена.
 */
@Configuration
@EnableWebSecurity
class SecurityConfig {

    @Bean
    fun filterChain(http: HttpSecurity): SecurityFilterChain {
        http.csrf { it.disable() }
            .authorizeHttpRequests { it.anyRequest().permitAll() }
        return http.build()
    }
}
