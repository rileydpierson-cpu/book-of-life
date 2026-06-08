package com.anonymous.bookoflifemobile.local

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.time.Instant

class MobileBootstrapWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result {
    return try {
      setForegroundAsync(MobileSyncProgress.update(applicationContext, "bootstrap", "Downloading your library index"))
      MobileCloudSync.sync(applicationContext) { phase, message, current, total ->
        setForegroundAsync(MobileSyncProgress.update(applicationContext, phase, message, current, total))
      }
      MobileLocalStore(applicationContext).use { store ->
        store.setState("initial_bootstrap_completed_at", Instant.now().toString())
        store.setState("mobile_setup_completed", "true")
        val token = MobileCloudSync.accessToken(store)
        val libraryId = store.getState("cloud_library_id").orEmpty()
        val deviceId = store.getState("cloud_device_id").orEmpty()
        if (token != null && libraryId.isNotBlank() && deviceId.isNotBlank()) {
          val preferences = org.json.JSONObject(store.getState("mobile_backup_preferences") ?: "{}")
          MobileCloudSync.request(token, "POST", "/api/backups/preferences", org.json.JSONObject()
            .put("libraryId", libraryId)
            .put("deviceId", deviceId)
            .put("cloudOriginalsEnabled", preferences.optBoolean("cloudOriginalsEnabled"))
            .put("desktopBackupEnabled", preferences.optBoolean("desktopBackupEnabled"))
            .put("desktopTargetDeviceId", preferences.optString("desktopTargetDeviceId"))
            .put("allowMobileData", preferences.optBoolean("allowMobileData"))
            .put("initialBootstrapCompleted", true))
        }
      }
      MobileSyncProgress.update(applicationContext, "complete", "Your library is ready", running = false)
      Result.success()
    } catch (error: Throwable) {
      MobileLocalStore(applicationContext).use { store ->
        store.setState("initial_bootstrap_error", error.message ?: "Initial sync failed.")
      }
      MobileSyncProgress.update(applicationContext, "error", "Initial sync failed", running = false, error = error.message ?: "Initial sync failed.")
      Result.retry()
    }
  }
}
