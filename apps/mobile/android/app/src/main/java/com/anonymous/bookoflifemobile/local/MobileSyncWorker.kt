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
      MobileCloudSync.sync(applicationContext)
      Result.success()
    } catch (error: Throwable) {
      MobileLocalStore(applicationContext).use { store ->
        store.setState("last_sync_error", error.message ?: "Cloud sync failed.")
      }
      Result.retry()
    }
  }
}
