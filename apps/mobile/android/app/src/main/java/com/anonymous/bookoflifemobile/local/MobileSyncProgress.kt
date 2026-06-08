package com.anonymous.bookoflifemobile.local

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.work.ForegroundInfo
import org.json.JSONObject
import java.time.Instant

object MobileSyncProgress {
  const val STATE_KEY = "mobile_sync_progress"
  private const val CHANNEL_ID = "book_of_life_sync"
  private const val NOTIFICATION_ID = 1201

  fun update(context: Context, phase: String, message: String, current: Int = 0, total: Int = 0, running: Boolean = true, error: String = ""): ForegroundInfo {
    val percent = if (total > 0) ((current.toDouble() / total.toDouble()) * 100).toInt().coerceIn(0, 100) else 0
    MobileLocalStore(context).use { store ->
      store.setState(STATE_KEY, JSONObject()
        .put("running", running)
        .put("phase", phase)
        .put("message", message)
        .put("current", current)
        .put("total", total)
        .put("percent", percent)
        .put("error", error)
        .put("updatedAt", Instant.now().toString())
        .toString())
    }
    createChannel(context)
    val notification = notification(context, message, percent, total > 0, running, error)
    val manager = context.getSystemService(NotificationManager::class.java)
    runCatching { manager.notify(NOTIFICATION_ID, notification) }
    if (!running && error.isBlank()) {
      Handler(Looper.getMainLooper()).postDelayed({ manager.cancel(NOTIFICATION_ID) }, 5_000)
    }
    return ForegroundInfo(NOTIFICATION_ID, notification)
  }

  private fun createChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    context.getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Book of Life sync", NotificationManager.IMPORTANCE_LOW)
    )
  }

  private fun notification(context: Context, message: String, percent: Int, determinate: Boolean, running: Boolean, error: String): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(context, CHANNEL_ID) else {
      @Suppress("DEPRECATION")
      Notification.Builder(context)
    }
    return builder
      .setContentTitle(if (error.isNotBlank()) "Book of Life sync needs attention" else "Book of Life")
      .setContentText(error.ifBlank { message })
      .setSmallIcon(context.applicationInfo.icon)
      .setOngoing(running)
      .setOnlyAlertOnce(true)
      .setProgress(if (determinate) 100 else 0, if (determinate) percent else 0, !determinate && running)
      .build()
  }
}
