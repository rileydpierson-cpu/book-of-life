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
import java.security.MessageDigest

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
        val deviceId = registration?.optString("deviceId").orEmpty().ifBlank { store.getState("cloud_device_id").orEmpty() }.ifBlank { "android-local" }
        val deviceName = registration?.optString("deviceName").orEmpty().ifBlank { "${Build.MANUFACTURER} ${Build.MODEL}".trim() }.ifBlank { "Android" }
        var indexed = 0
        var published = 0
        indexed += scanCollection(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "image", store, token, libraryId, deviceId, deviceName) { published += it }
        indexed += scanCollection(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, "video", store, token, libraryId, deviceId, deviceName) { published += it }
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
    deviceName: String,
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
        val existingRecord = store.getMedia(localId)
        val cloudLocalId = localId
        val fileName = cursor.getString(nameColumn).orEmpty().ifBlank { if (type == "video") "Untitled video.mp4" else "Untitled photo.jpg" }
        val capturedMs = cursor.getLong(takenColumn).takeIf { it > 0 } ?: cursor.getLong(modifiedColumn) * 1000
        val capturedAt = Instant.ofEpochMilli(capturedMs).toString()
        val isoDate = DateTimeFormatter.ISO_LOCAL_DATE.format(Instant.ofEpochMilli(capturedMs).atZone(ZoneId.systemDefault()))
        val width = cursor.getInt(widthColumn)
        val height = cursor.getInt(heightColumn)
        val folder = cursor.getString(pathColumn).orEmpty()
        val size = cursor.getLong(sizeColumn)
        val mimeType = cursor.getString(mimeColumn).orEmpty()
        val contentHash = hashContent(localUri)
        val relativePath = listOf(folder.trim('/'), fileName).filter { it.isNotBlank() }.joinToString("/")
        val location = JSONObject()
          .put("deviceId", deviceId)
          .put("deviceName", deviceName)
          .put("deviceType", "android")
          .put("localMediaId", localId)
          .put("fileName", fileName.ifBlank { if (type == "video") "Untitled video.mp4" else "Untitled photo.jpg" })
          .put("storageRootId", "media-store")
          .put("storageRootLabel", "Media")
          .put("relativePath", relativePath)
          .put("size", size)
          .put("availability", "available")
        val locationsJson = mergeLocations(existingRecord?.locationsJson, location, deviceId)
        store.upsertMedia(localId, localUri, store.mediaCloudId(localId), fileName, type, isoDate, capturedAt, width, height, folder, false, deviceId, Instant.now().toString(), contentHash, "media-store", locationsJson)
        indexed += 1

        val needsCloudRepair = existingRecord?.cloudId.isNullOrBlank()
          || existingRecord?.contentHash.isNullOrBlank()
          || existingRecord?.fileName.isNullOrBlank()
          || existingRecord?.locationsJson.isNullOrBlank()
          || existingRecord?.locationsJson == "[]"
        if (publishBudget > 0 && token != null && libraryId.isNotBlank() && deviceId.isNotBlank() && needsCloudRepair) {
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
            .put("deviceId", deviceId)
            .put("contentHash", contentHash)
            .put("localMediaId", cloudLocalId)
            .put("previousLocalMediaId", "android:$deviceId:$type:$mediaId")
            .put("fileSignature", "$cloudLocalId:$capturedMs:$size")
            .put("isoDate", isoDate)
            .put("fileName", fileName)
            .put("metadata", metadata)
            .put("location", location)
            .put("originalOnHost", true)
            .put("originalInCloud", false)
            .put("originalSize", size)
            .put("originalContentType", mimeType))
          val cloudId = response.getJSONObject("media").getString("id")
          val thumb = MobileCloudSync.uploadThumbnail(applicationContext, token, libraryId, cloudId, localUri)
          if (thumb != null) {
            MobileCloudSync.request(token, "POST", "/api/media", JSONObject()
              .put("libraryId", libraryId)
              .put("hostDeviceId", deviceId)
              .put("deviceId", deviceId)
              .put("contentHash", contentHash)
              .put("localMediaId", cloudLocalId)
              .put("previousLocalMediaId", "android:$deviceId:$type:$mediaId")
              .put("fileSignature", "$cloudLocalId:$capturedMs:$size")
              .put("isoDate", isoDate)
              .put("fileName", fileName)
              .put("metadata", metadata)
              .put("location", location)
              .put("hasThumb", true)
              .put("thumbStoragePath", thumb.getString("storagePath"))
              .put("thumbContentType", thumb.getString("contentType"))
              .put("originalOnHost", true)
              .put("originalInCloud", false)
              .put("originalSize", size)
              .put("originalContentType", mimeType))
          }
          store.upsertMedia(localId, localUri, cloudId, fileName, type, isoDate, capturedAt, width, height, folder, false, deviceId, Instant.now().toString(), contentHash, "media-store", locationsJson)
          publishBudget -= 1
          onPublished(1)
        }
      }
    }
    return indexed
  }

  private fun hashContent(localUri: String): String {
    return try {
      val digest = MessageDigest.getInstance("SHA-256")
      applicationContext.contentResolver.openInputStream(Uri.parse(localUri))?.use { input ->
        val buffer = ByteArray(1024 * 1024)
        while (true) {
          val count = input.read(buffer)
          if (count <= 0) break
          digest.update(buffer, 0, count)
        }
      } ?: return ""
      digest.digest().joinToString("") { "%02x".format(it) }
    } catch (_: Throwable) {
      ""
    }
  }

  private fun mergeLocations(existingJson: String?, current: JSONObject, deviceId: String): String {
    val merged = org.json.JSONArray()
    try {
      val existing = org.json.JSONArray(existingJson ?: "[]")
      for (index in 0 until existing.length()) {
        val location = existing.getJSONObject(index)
        if (location.optString("deviceId") != deviceId) merged.put(location)
      }
    } catch (_: Throwable) {}
    merged.put(current)
    return merged.toString()
  }
}
