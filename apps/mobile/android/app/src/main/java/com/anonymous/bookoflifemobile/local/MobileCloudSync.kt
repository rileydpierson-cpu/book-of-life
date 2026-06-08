package com.anonymous.bookoflifemobile.local

import android.content.Context
import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Size
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URLEncoder
import java.net.URL
import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets
import java.time.Instant

object MobileCloudSync {
  private const val API_BASE = "https://book-of-life-two.vercel.app"
  private const val SESSION_KEY = "cloud_session"
  private const val LIBRARY_ID_KEY = "cloud_library_id"
  private const val DEVICE_ID_KEY = "cloud_device_id"
  private const val CHANGE_CURSOR_KEY = "cloud_change_cursor"

  fun sync(context: Context): JSONObject {
    MobileLocalStore(context).use { store ->
      val token = accessToken(store) ?: return JSONObject().put("skipped", true).put("reason", "not-signed-in")
      val registration = ensureRegistration(context, store, token)
      val libraryId = registration.getString("libraryId")
      val deviceId = registration.getString("deviceId")

      var pushed = 0
      for (entry in store.listDirtyEntries()) {
        val saved = request(
          token,
          "POST",
          "/api/entries",
          JSONObject()
            .put("libraryId", libraryId)
            .put("isoDate", entry.isoDate)
            .put("raw", entry.raw)
            .put("deviceId", deviceId)
            .put("baseCloudVersion", entry.cloudVersion)
        ).getJSONObject("entry")
        store.markEntryClean(
          entry.isoDate,
          saved.optLong("cloudVersion", entry.cloudVersion),
          saved.optString("updatedAt", Instant.now().toString())
        )
        pushed += 1
      }

      val remoteEntries = request(token, "GET", "/api/entries?libraryId=${encode(libraryId)}").optJSONArray("entries") ?: JSONArray()
      var pulled = 0
      for (index in 0 until remoteEntries.length()) {
        val remote = remoteEntries.getJSONObject(index)
        val isoDate = remote.optString("isoDate")
        val local = store.getEntry(isoDate)
        val remoteVersion = remote.optLong("cloudVersion", 0)
        if (local == null || (!local.dirty && remoteVersion >= local.cloudVersion)) {
          store.saveCloudEntry(isoDate, remote.optString("raw"), remoteVersion, remote.optString("updatedAt"))
          pulled += 1
        }
      }

      val media = request(token, "GET", "/api/media?libraryId=${encode(libraryId)}").optJSONArray("media") ?: JSONArray()
      for (index in 0 until media.length()) {
        val item = media.getJSONObject(index)
        val metadata = item.optJSONObject("metadata") ?: JSONObject()
        val cloudId = item.getString("id")
        val contentHash = item.optString("contentHash").ifBlank { null }
        val locations = item.optJSONArray("locations") ?: JSONArray()
        val currentLocation = (0 until locations.length())
          .map { locations.getJSONObject(it) }
          .firstOrNull { it.optString("deviceId") == deviceId }
        val existing = contentHash?.let { store.mediaByContentHash(it) } ?: store.mediaByCloudId(cloudId)
        if (existing != null && existing.id != "cloud:$cloudId") store.deleteMedia("cloud:$cloudId")
        val fileName = currentLocation?.optString("fileName").orEmpty()
          .ifBlank { item.optString("fileName") }
          .ifBlank { if (metadata.optString("type") == "video") "Untitled video.mp4" else "Untitled photo.jpg" }
        val relativePath = currentLocation?.optString("relativePath").orEmpty()
        val folder = relativePath.substringBeforeLast('/', "").ifBlank {
          metadata.optString("folder").trim('/').takeUnless { it.equals("Temp", ignoreCase = true) }.orEmpty()
        }.ifBlank { null }
        store.upsertMedia(
          id = existing?.id ?: "cloud:$cloudId",
          localUri = existing?.localUri,
          cloudId = cloudId,
          fileName = fileName,
          mediaType = metadata.optString("type", "image"),
          isoDate = item.optString("isoDate").ifBlank { null },
          capturedAt = metadata.optString("captured_at").ifBlank { null },
          width = metadata.optInt("width"),
          height = metadata.optInt("height"),
          folder = folder,
          originalInCloud = item.optBoolean("originalInCloud"),
          desktopHostDeviceId = item.optString("hostDeviceId").ifBlank { null },
          updatedAt = item.optString("updatedAt"),
          contentHash = contentHash ?: existing?.contentHash,
          folderRootId = currentLocation?.optString("storageRootId").orEmpty().ifBlank { existing?.folderRootId.orEmpty() },
          locationsJson = locations.toString()
        )
      }

      val actions = request(token, "GET", "/api/media/actions?libraryId=${encode(libraryId)}&hostDeviceId=${encode(deviceId)}&status=pending")
        .optJSONArray("actions") ?: JSONArray()
      var appliedActions = 0
      for (index in 0 until actions.length()) {
        val action = actions.getJSONObject(index)
        val payload = action.optJSONObject("payload") ?: JSONObject()
        val record = store.getMedia(payload.optString("photoId"))
        val result = JSONObject()
        val status = try {
          if (record?.localUri == null) error("Local media is unavailable.")
          when (action.optString("action_type")) {
            "media.rename" -> {
              val ext = record.fileName.substringAfterLast('.', "").let { if (it.isBlank()) "" else ".$it" }
              val nextName = payload.optString("baseName").trim().ifBlank { error("Filename cannot be empty.") } + ext
              val values = ContentValues().apply { put(MediaStore.MediaColumns.DISPLAY_NAME, nextName) }
              if (context.contentResolver.update(Uri.parse(record.localUri), values, null, null) <= 0) error("Android did not rename this media.")
              result.put("photoId", record.id).put("renamedTo", nextName)
            }
            "media.move" -> {
              val nextPath = payload.optString("relativePath").trim('/').let { if (it.isBlank()) "" else "$it/" }
              val values = ContentValues().apply { put(MediaStore.MediaColumns.RELATIVE_PATH, nextPath) }
              if (context.contentResolver.update(Uri.parse(record.localUri), values, null, null) <= 0) error("Android did not move this media.")
              result.put("photoId", record.id).put("relativePath", nextPath.trim('/'))
            }
            "media.delete" -> {
              if (context.contentResolver.delete(Uri.parse(record.localUri), null, null) <= 0) error("Android did not delete this media.")
              store.deleteMedia(record.id)
              result.put("photoId", record.id).put("deleted", true)
            }
            else -> error("Unsupported mobile media action.")
          }
          appliedActions += 1
          "applied"
        } catch (error: Throwable) {
          result.put("error", error.message ?: "Permission required on this device.")
          "pending"
        }
        request(token, "PATCH", "/api/media/actions/${encode(action.getString("id"))}", JSONObject()
          .put("libraryId", libraryId)
          .put("status", status)
          .put("result", result))
      }

      val cursor = request(token, "GET", "/api/sync/entry-summary?libraryId=${encode(libraryId)}").optLong("cursor", 0)
      store.setState(CHANGE_CURSOR_KEY, cursor.toString())
      store.setState("last_sync_at", Instant.now().toString())
      store.setState("last_sync_result", JSONObject()
        .put("pushedEntries", pushed)
        .put("pulledEntries", pulled)
        .put("cloudMedia", media.length())
        .put("appliedMediaActions", appliedActions)
        .put("libraryId", libraryId)
        .put("deviceId", deviceId)
        .toString())
      return JSONObject()
        .put("ok", true)
        .put("pushedEntries", pushed)
        .put("pulledEntries", pulled)
        .put("cloudMedia", media.length())
    }
  }

  @Synchronized
  fun ensureRegistration(context: Context, store: MobileLocalStore, token: String = accessToken(store) ?: error("Not signed in.")): JSONObject {
    var libraryId = store.getState(LIBRARY_ID_KEY).orEmpty()
    if (libraryId.isBlank()) {
      val libraries = request(token, "GET", "/api/libraries").optJSONArray("libraries") ?: JSONArray()
      val library = if (libraries.length() > 0) libraries.getJSONObject(0) else {
        request(token, "POST", "/api/libraries", JSONObject().put("name", "Book of Life")).getJSONObject("library")
      }
      libraryId = library.getString("id")
      store.setState(LIBRARY_ID_KEY, libraryId)
    }

    var deviceId = store.getState(DEVICE_ID_KEY).orEmpty()
    val payload = JSONObject()
      .put("libraryId", libraryId)
      .put("deviceName", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
      .put("deviceType", "android")
      .put("canUploadMedia", true)
      .put("canEditEntries", true)
      .put("canRequestOriginals", true)
      .put("canUseDesktopHost", false)
    if (deviceId.isNotBlank()) payload.put("deviceId", deviceId)
    val device = request(token, "POST", "/api/devices", payload).getJSONObject("device")
    deviceId = device.getString("id")
    store.setState(DEVICE_ID_KEY, deviceId)
    return JSONObject()
      .put("libraryId", libraryId)
      .put("deviceId", deviceId)
      .put("deviceName", device.optString("device_name").ifBlank { payload.optString("deviceName") })
  }

  fun accessToken(store: MobileLocalStore): String? {
    val raw = store.getState(SESSION_KEY) ?: return null
    return try {
      val session = JSONObject(raw)
      val expiresAt = session.optLong("expires_at", session.optJSONObject("session")?.optLong("expiresAt") ?: 0)
      val refreshToken = session.optString("refresh_token").ifBlank {
        session.optJSONObject("session")?.optString("refreshToken").orEmpty()
      }
      if (expiresAt > 0 && expiresAt <= Instant.now().epochSecond + 90 && refreshToken.isNotBlank()) {
        val refreshed = requestWithoutAuth(
          "POST",
          "https://mqbmkqikhqvhvwyaqemg.supabase.co/auth/v1/token?grant_type=refresh_token",
          JSONObject().put("refresh_token", refreshToken),
          mapOf("apikey" to "sb_publishable_8xCIi6EckUw25Yg6R2hEDQ_gsc3i8_D")
        )
        store.setState(SESSION_KEY, refreshed.toString())
        refreshed.optString("access_token").ifBlank { null }
      } else {
        session.optString("access_token").ifBlank {
          session.optJSONObject("session")?.optString("accessToken").orEmpty()
        }.ifBlank { null }
      }
    } catch (_: Throwable) {
      null
    }
  }

  fun request(token: String, method: String, path: String, body: JSONObject? = null): JSONObject {
    return requestWithoutAuth(method, "$API_BASE$path", body, mapOf("Authorization" to "Bearer $token"))
  }

  fun uploadThumbnail(context: Context, token: String, libraryId: String, mediaId: String, localUri: String): JSONObject? {
    return try {
      val thumbnail = context.contentResolver.loadThumbnail(Uri.parse(localUri), Size(640, 640), null)
      val output = ByteArrayOutputStream()
      thumbnail.compress(android.graphics.Bitmap.CompressFormat.JPEG, 82, output)
      thumbnail.recycle()
      val bytes = output.toByteArray()
      val ticket = request(token, "POST", "/api/media/derivative-upload-url", JSONObject()
        .put("libraryId", libraryId)
        .put("mediaId", mediaId)
        .put("variant", "thumb")
        .put("fileName", "$mediaId.jpg"))
      val connection = URL(ticket.getString("signedUrl")).openConnection() as HttpURLConnection
      connection.requestMethod = "PUT"
      connection.connectTimeout = 20_000
      connection.readTimeout = 30_000
      connection.doOutput = true
      connection.setRequestProperty("Content-Type", "image/jpeg")
      connection.setRequestProperty("Cache-Control", "max-age=31536000")
      connection.outputStream.use { it.write(bytes) }
      if (connection.responseCode !in 200..299) error("Thumbnail upload failed (${connection.responseCode}).")
      JSONObject()
        .put("storagePath", ticket.getString("objectPath"))
        .put("contentType", "image/jpeg")
    } catch (_: Throwable) {
      null
    }
  }

  private fun requestWithoutAuth(method: String, url: String, body: JSONObject?, headers: Map<String, String>): JSONObject {
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.requestMethod = method
    connection.connectTimeout = 20_000
    connection.readTimeout = 30_000
    connection.setRequestProperty("Content-Type", "application/json")
    headers.forEach { (key, value) -> connection.setRequestProperty(key, value) }
    if (body != null) {
      connection.doOutput = true
      connection.outputStream.use { it.write(body.toString().toByteArray(StandardCharsets.UTF_8)) }
    }
    val status = connection.responseCode
    val text = (if (status in 200..299) connection.inputStream else connection.errorStream)
      ?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }.orEmpty()
    val payload = JSONObject(text.ifBlank { "{}" })
    if (status !in 200..299) error(payload.optString("error", "Cloud request failed ($status)."))
    return payload
  }

  private fun encode(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8.name())
}
