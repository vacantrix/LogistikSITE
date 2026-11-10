pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "azmz-driver"

include(":app")
include(":core:common", ":core:data", ":core:sync", ":core:ui")
include(":feature:map", ":feature:trip", ":feature:history", ":feature:office")
