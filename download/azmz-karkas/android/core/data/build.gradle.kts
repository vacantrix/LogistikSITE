plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

android {
    namespace = "ru.azmz.logistics.driver.core.data"
    compileSdk = 34

    defaultConfig { minSdk = 26 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    api(project(":core:common"))

    api(libs.androidx.room.runtime)
    api(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    implementation(libs.squareup.retrofit)
    implementation(libs.squareup.retrofit.kotlinx.serialization)
    implementation(libs.kotlinx.serialization.json)
    testImplementation(libs.junit)
}

ksp {
    // Схемы Room коммитим в git: миграции — «трудно исправить позже»,
    // история схемы обязательна до первого релиза (см. README)
    arg("room.schemaLocation", "$projectDir/schemas")
}
