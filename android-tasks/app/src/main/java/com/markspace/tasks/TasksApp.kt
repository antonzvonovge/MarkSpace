package com.markspace.tasks

import android.app.Application
import com.markspace.tasks.data.SyncPreferences

class TasksApp : Application() {
    lateinit var syncPreferences: SyncPreferences
        private set

    override fun onCreate() {
        super.onCreate()
        syncPreferences = SyncPreferences(this)
    }
}
