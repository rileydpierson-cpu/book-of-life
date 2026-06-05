package com.anonymous.bookoflifemobile.local

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import java.time.Instant

class MobileIndexService : Service() {
  override fun onCreate() {
    super.onCreate()
    MobileLocalServer.ensureStarted(applicationContext)
    createChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startForeground(1001, notification("Preparing local library"))
    MobileLocalStore(applicationContext).use { store ->
      store.setState("last_foreground_index_at", Instant.now().toString())
    }
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf(startId)
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Book of Life indexing",
      NotificationManager.IMPORTANCE_LOW
    )
    manager.createNotificationChannel(channel)
  }

  private fun notification(text: String): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    return builder
      .setContentTitle("Book of Life")
      .setContentText(text)
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .build()
  }

  companion object {
    private const val CHANNEL_ID = "book_of_life_indexing"
  }
}
