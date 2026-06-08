package com.anonymous.bookoflifemobile.local

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters

class MobileSyncWorker(
  context: Context,
  params: WorkerParameters
) : Worker(context, params) {
  override fun doWork(): Result {
    return try {
      MobileLocalServer.ensureStarted(applicationContext)
      setForegroundAsync(MobileSyncProgress.update(applicationContext, "sync", "Syncing your library"))
      MobileCloudSync.sync(applicationContext)
      MobileSyncProgress.update(applicationContext, "complete", "Library sync complete", running = false)
      Result.success()
    } catch (error: Throwable) {
      MobileLocalStore(applicationContext).use { store ->
        store.setState("last_sync_error", error.message ?: "Cloud sync failed.")
      }
      MobileSyncProgress.update(applicationContext, "error", "Library sync failed", running = false, error = error.message ?: "Cloud sync failed.")
      Result.retry()
    }
  }
}
