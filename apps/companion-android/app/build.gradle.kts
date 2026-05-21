plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.her.companion"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.her.companion"
        minSdk = 26       // Android 8.0+ — covers everything reasonable
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // Only Android core libs + one for encrypted prefs. No analytics, no
    // remote config, no ads, no crash reporting, no Firebase.
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
}
