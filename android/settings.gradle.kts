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
rootProject.name = "PayTrace"
include(":app")
// The dashboard as an Android app (2026-11-09): opens the live dashboard full screen. See dashboard/build.gradle.kts.
include(":dashboard")
