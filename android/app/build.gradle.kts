plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}
android {
    namespace = "io.github.u702165405.cxpalm"
    compileSdk = 35
    defaultConfig {
        applicationId = "io.github.u702165405.cxpalm"
        minSdk = 26
        targetSdk = 35
        versionCode = 13
        versionName = "0.0.11"
    }
    sourceSets.getByName("main").assets.srcDir(rootProject.file("../locales"))
    if (providers.gradleProperty("renderProbe").orNull == "true") {
        sourceSets.getByName("debug").java.srcDir("src/renderProbe/java")
        sourceSets.getByName("debug").manifest.srcFile("src/renderProbe/AndroidManifest.xml")
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    buildTypes.getByName("debug") { applicationIdSuffix = ".debug" }
    signingConfigs.getByName("debug") {
        storeFile = file(System.getenv("CXPALM_DEBUG_KEYSTORE") ?: rootProject.file("../.local/android-debug.jks").path)
        storePassword = "android"
        keyAlias = "androiddebugkey"
        keyPassword = "android"
    }
}
dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.03.01"))
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.commonmark:commonmark:0.24.0")
    implementation("org.commonmark:commonmark-ext-gfm-tables:0.24.0")
    implementation("org.commonmark:commonmark-ext-gfm-strikethrough:0.24.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
