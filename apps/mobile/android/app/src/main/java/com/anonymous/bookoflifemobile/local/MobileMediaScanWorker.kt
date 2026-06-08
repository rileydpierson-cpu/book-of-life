package com.anonymous.bookoflifemobile.local

import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class MobileMediaScanWorker(
  context: Context,
  params: WorkerParameters
) : Worker(context, params) {
  private var publishBudget = 100

  override fun doWork(): Result {
    return try {
      MobileLocalServer.ensureStarted(applicationContext)
      MobileLocalStore(applicationContext).use { store ->
        if (!hasMediaPermission()) {
          store.setState("last_media_scan_error", "Media permission is required.")
          return Result.success()
        }
        val token = MobileCloudSync.accessToken(store)
        val registration = if (token != null) MobileCloudSync.ensureRegistration(applicationContext, store, token) else null
        val libraryId = registration?.optString("libraryId").orEmpty()
        val deviceId = registration?.optString("deviceId").orEmpty()
        var indexed = 0
        var published = 0
        indexed += scanCollection(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "image", store, token, libraryId, deviceId) { published += it }
        indexed += scanCollection(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, "video", store, token, libraryId, deviceId) { published += it }
        store.setState("last_media_scan_at", Instant.now().toString())
        store.setState("last_media_scan_result", JSONObject().put("indexed", indexed).put("published", published).toString())
      }
      Result.success()
    } catch (error: Throwable) {
      MobileLocalStore(applicationContext).use { store ->
        store.setState("last_media_scan_error", error.message ?: "Media scan failed.")
      }
      Result.retry()
    }
  }

  private fun hasMediaPermission(): Boolean {
    val permissions = if (Build.VERSION.SDK_INT >= 33) {
      arrayOf(android.Manifest.permission.READ_MEDIA_IMAGES, android.Manifest.permission.READ_MEDIA_VIDEO)
    } else {
      arrayOf(android.Manifest.permission.READ_EXTERNAL_STORAGE)
    }
    return permissions.any { applicationContext.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
  }

  private fun scanCollection(
    collection: Uri,
    type: String,
    store: MobileLocalStore,
    token: String?,
    libraryId: String,
    deviceId: String,
    onPublished: (Int) -> Unit
  ): Int {
    val projection = arrayOf(
      MediaStore.MediaColumns._ID,
      MediaStore.MediaColumns.DISPLAY_NAME,
      MediaStore.MediaColumns.DATE_TAKEN,
      MediaStore.MediaColumns.DATE_MODIFIED,
      MediaStore.MediaColumns.WIDTH,
      MediaStore.MediaColumns.HEIGHT,
      MediaStore.MediaColumns.RELATIVE_PATH,
      MediaStore.MediaColumns.SIZE,
      MediaStore.MediaColumns.MIME_TYPE
    )
    var indexed = 0
    applicationContext.contentResolver.query(collection, projection, null, null, "${MediaStore.MediaColumns.DATE_MODIFIED} DESC")?.use { cursor ->
      val idColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
      val nameColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
      val takenColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_TAKEN)
      val modifiedColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_MODIFIED)
      val widthColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.WIDTH)
      val heightColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.HEIGHT)
      val pathColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.RELATIVE_PATH)
      val sizeColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE)
      val mimeColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE)
      while (cursor.moveToNext()) {
        val mediaId = cursor.getLong(idColumn)
        val localUri = Uri.withAppendedPath(collection, mediaId.toString()).toString()
        val localId = "android:$type:$mediaId"
        val cloudLocalId = "android:$deviceId:$type:$mediaId"
        val fileName = cursor.getString(nameColumn).orEmpty()
        val capturedMs = cursor.getLong(takenColumn).takeIf { it > 0 } ?: cursor.getLong(modifiedColumn) * 1000
        val capturedAt = Instant.ofEpochMilli(capturedMs).toString()
        val isoDate = DateTimeFormatter.ISO_LOCAL_DATE.format(Instant.ofEpochMilli(capturedMs).atZone(ZoneId.systemDefault()))
        val width = cursor.getInt(widthColumn)
        val height = cursor.getInt(heightColumn)
        val folder = cursor.getString(pathColumn).orEmpty()
        val size = cursor.getLong(sizeColumn)
        val mimeType = cursor.getString(mimeColumn).orEmpty()
        store.upsertMedia(localId, localUri, store.mediaCloudId(localId), fileName, type, isoDate, capturedAt, width, height, folder, false, deviceId, Instant.now().toString())
        indexed += 1

        if (publishBudget > 0 && token != null && libraryId.isNotBlank() && deviceId.isNotBlank() && store.mediaCloudId(localId).isNullOrBlank()) {
          val metadata = JSONObject()
            .put("type", type)
            .put("captured_at", capturedAt)
            .put("width", width)
            .put("height", height)
            .put("folder", folder)
            .put("size", size)
            .put("source", "android-media-store")
          val response = MobileCloudSync.request(token, "POST", "/api/media", JSONObject()
            .put("libraryId", libraryId)
            .put("hostDeviceId", deviceId)
            .put("localMediaId", cloudLocalId)
            .put("fileSignature", "$cloudLocalId:$capturedMs:$size")
            .put("isoDate", isoDate)
            .put("fileName", fileName)
            .put("metadata", metadata)
            .put("originalOnHost", true)
            .put("originalInCloud", false)
            .put("originalSize", size)
            .put("originalContentType", mimeType))
          val cloudId = response.getJSONObject("media").getString("id")
          store.upsertMedia(localId, localUri, cloudId, fileName, type, isoDate, capturedAt, width, height, folder, false, deviceId, Instant.now().toString())
          publishBudget -= 1
          onPublished(1)
        }
      }
    }
    return indexed
  }
}
