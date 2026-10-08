// Versions live here. The app module applies the plugins without a version.
plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
    // On the classpath only. app/build.gradle.kts applies it when app/google-services.json exists.
    id("com.google.gms.google-services") version "4.5.0" apply false
}
