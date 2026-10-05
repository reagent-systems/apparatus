import java.util.Base64
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// The one server setting. It is compiled in; the app has no UI to change it (design spec, Security rule 9).
val serverOrigin: String = (findProperty("APPARATUS_SERVER_ORIGIN") as String?)
    ?.trim()
    ?.trimEnd('/')
    ?.takeIf { it.isNotEmpty() }
    ?: "http://10.0.2.2:8080"

// Release signing comes from the environment only. Without all 4 values the release APK is unsigned.
val envKeystoreBase64: String = System.getenv("ANDROID_KEYSTORE_BASE64").orEmpty()
val envKeystorePassword: String = System.getenv("ANDROID_KEYSTORE_PASSWORD").orEmpty()
val envKeyAlias: String = System.getenv("ANDROID_KEY_ALIAS").orEmpty()
val envKeyPassword: String = System.getenv("ANDROID_KEY_PASSWORD").orEmpty()
val hasReleaseSigning: Boolean =
    listOf(envKeystoreBase64, envKeystorePassword, envKeyAlias, envKeyPassword).all { it.isNotEmpty() }

android {
    namespace = "systems.reagent.apparatus.wear"
    compileSdk = 34

    defaultConfig {
        applicationId = "systems.reagent.apparatus.wear"
        minSdk = 30
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "SERVER_ORIGIN", "\"$serverOrigin\"")
        // Cleartext only for an http:// origin, which is the emulator default.
        manifestPlaceholders["cleartext"] = serverOrigin.startsWith("http://").toString()
    }

    if (hasReleaseSigning) {
        signingConfigs {
            create("release") {
                val keystore = layout.buildDirectory.file("release.jks").get().asFile
                keystore.parentFile.mkdirs()
                keystore.writeBytes(Base64.getMimeDecoder().decode(envKeystoreBase64))
                storeFile = keystore
                storePassword = envKeystorePassword
                keyAlias = envKeyAlias
                keyPassword = envKeyPassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}")
    }

    testOptions {
        unitTests.all { test ->
            // The voice gate vectors are shared with the web and watchOS ports; read in place, never copied.
            val vectors = rootProject.layout.projectDirectory.file("../shared/gate-vectors.json").asFile
            test.inputs.file(vectors).withPropertyName("gateVectors")
            test.systemProperty("apparatus.gateVectors", vectors.absolutePath)
            test.testLogging {
                events("passed", "failed")
                showStandardStreams = true
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.09.03"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.runtime:runtime")
    implementation("androidx.activity:activity-compose:1.9.3")
    // androidx.wear and Firebase pull Fragment 1.2.4; registerForActivityResult needs 1.3.0 or
    // newer, and release lint (InvalidFragmentVersionForActivityResult) fails without this.
    implementation("androidx.fragment:fragment:1.8.5")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.wear:wear:1.3.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.security:security-crypto:1.1.0")
    implementation(platform("com.google.firebase:firebase-bom:34.19.0"))
    implementation("com.google.firebase:firebase-messaging")

    testImplementation("junit:junit:4.13.2")
    // android.jar's org.json is a stub on the JVM; the tests parse JSON with the real one.
    testImplementation("org.json:json:20240303")
}

// Firebase needs app/google-services.json. The build must succeed without it.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}
