package com.anonymous.bookoflifemobile.local

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object MobileBackgroundScheduler {
  private const val SYNC_WORK = "book-of-life-mobile-sync"
  private const val MEDIA_SCAN_WORK = "book-of-life-mobile-media-scan"
  private const val BOOTSTRAP_WORK = "book-of-life-mobile-bootstrap"

  fun schedule(context: Context) {
    val appContext = context.applicationContext
    val connected = Constraints.Builder()
      .setRequiredNetworkType(NetworkType.CONNECTED)
      .build()

    val syncRequest = PeriodicWorkRequestBuilder<MobileSyncWorker>(15, TimeUnit.MINUTES)
      .setConstraints(connected)
      .addTag(SYNC_WORK)
      .build()
    val scanRequest = PeriodicWorkRequestBuilder<MobileMediaScanWorker>(6, TimeUnit.HOURS)
      .addTag(MEDIA_SCAN_WORK)
      .build()

    WorkManager.getInstance(appContext).enqueueUniquePeriodicWork(
      SYNC_WORK,
      ExistingPeriodicWorkPolicy.UPDATE,
      syncRequest
    )
    WorkManager.getInstance(appContext).enqueueUniquePeriodicWork(
      MEDIA_SCAN_WORK,
      ExistingPeriodicWorkPolicy.UPDATE,
      scanRequest
    )
  }

  fun syncNow(context: Context) {
    WorkManager.getInstance(context.applicationContext).enqueue(
      OneTimeWorkRequestBuilder<MobileSyncWorker>().build()
    )
  }

  fun bootstrapNow(context: Context) {
    WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
      BOOTSTRAP_WORK,
      androidx.work.ExistingWorkPolicy.REPLACE,
      OneTimeWorkRequestBuilder<MobileBootstrapWorker>()
        .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        .build()
    )
  }

  fun scanNow(context: Context) {
    WorkManager.getInstance(context.applicationContext).enqueue(
      OneTimeWorkRequestBuilder<MobileMediaScanWorker>().build()
    )
  }
}
