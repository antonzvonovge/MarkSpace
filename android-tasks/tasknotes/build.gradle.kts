plugins {
    id("org.jetbrains.kotlin.jvm")
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation("org.yaml:snakeyaml:2.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlin:kotlin-test-junit")
}

// Share fixtures from monorepo root with JVM tests.
tasks.test {
    val fixtures = rootProject.projectDir.resolve("../fixtures/task-notes")
    inputs.dir(fixtures).optional()
    doFirst {
        systemProperty("tasknotes.fixtures", fixtures.absolutePath)
    }
}
