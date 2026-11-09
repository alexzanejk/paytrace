// The PayTrace DASHBOARD as an Android app (owner 2026-11-09: "we need our PayTrace dashboard app so we can manage everything
// from the app"). Not the payment-phone app (:app): this one only opens the live dashboard full screen, as a Trusted Web
// Activity (Chrome inside an app window, no address bar once the site and this app vouch for each other through
// dashboard/public/.well-known/assetlinks.json). So it is always the newest dashboard, the login and two-step code are the
// dashboard's own, CSV downloads work, and the app itself rarely needs updating. No Kotlin of our own: the launcher is
// Google's android-browser-helper, configured in the manifest. Signed with the SAME key as the phone app (same GitHub
// secrets), which is also the fingerprint in assetlinks.json.
plugins {
    id("com.android.application")
}

android {
    namespace = "com.paytrace.dashboard"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.paytrace.dashboard"
        minSdk = 26
        targetSdk = 34
        val code = System.getenv("PAYTRACE_VERSION_CODE")?.toIntOrNull() ?: 1
        versionCode = code
        versionName = "1.0.$code"
    }

    val keystorePath = System.getenv("ANDROID_KEYSTORE_PATH")
    signingConfigs {
        if (!keystorePath.isNullOrBlank()) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (!keystorePath.isNullOrBlank()) signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.5.0")
}
