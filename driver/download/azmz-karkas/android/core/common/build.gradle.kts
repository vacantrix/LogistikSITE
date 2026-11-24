plugins {
    alias(libs.plugins.kotlin.jvm)
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    // правила событий и гео-утилиты — чистый Kotlin без Android-зависимостей:
    // кандидат на вынос в общий KMP-модуль с сервером (одна и та же логика
    // авто-закрытия интервалов на клиенте и на сервере)
    implementation(libs.kotlinx.serialization.json)
    testImplementation(libs.junit)
}
