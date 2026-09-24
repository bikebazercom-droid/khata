plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val webAppUrl = providers.gradleProperty("webAppUrl")
    .orElse("https://hazarikhata.replit.app/")
    .get()
    .trim()

if (!webAppUrl.startsWith("https://")) {
    throw GradleException("webAppUrl must use HTTPS.")
}

android {
    namespace = "com.banglakhata.webview"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.banglakhata.webview"
        minSdk = 23
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
        buildConfigField("String", "WEB_APP_URL", "\"${webAppUrl.replace("\\", "\\\\").replace("\"", "\\\"")}\"")
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}