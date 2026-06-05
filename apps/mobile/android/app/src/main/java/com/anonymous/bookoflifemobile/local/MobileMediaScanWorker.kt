package com.anonymous.bookoflifemobile.local

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.time.Instant

class MobileMediaScanWorker(
  context: Context,
  params: WorkerParameters
) : Worker(context, params) {
  override fun doWork(): Result {
    return try {
      MobileLocalServer.ensureStarted(applicationContext)
      MobileLocalStore(applicationContext).use { store ->
        store.setState("last_media_scan_at", Instant.now().toString())
      }
      Result.success()
    } catch (_: Throwable) {
      Result.retry()
    }
  }
}
