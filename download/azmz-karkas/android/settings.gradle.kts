pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

// Автозагрузка JDK-тулчейна 17 (core/common), если на машине только JDK 21
plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "0.8.0"
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        // зеркало Maven Central: меньше rate-limit 429 на CI/песочнице
        maven { url = uri("https://maven.aliyun.com/repository/central") }
        mavenCentral()
    }
}

rootProject.name = "azmz-driver"

include(":app")
include(":core:common", ":core:data", ":core:sync", ":core:ui")
include(":feature:map", ":feature:trip", ":feature:history", ":feature:office")
