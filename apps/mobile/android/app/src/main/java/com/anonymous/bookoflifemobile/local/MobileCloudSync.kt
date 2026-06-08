package com.anonymous.bookoflifemobile.local

import android.content.Context
import android.os.Build
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URLEncoder
import java.net.URL
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
        store.upsertMedia(
          id = "cloud:${item.getString("id")}",
          localUri = null,
          cloudId = item.getString("id"),
          fileName = item.optString("fileName"),
          mediaType = metadata.optString("type", "image"),
          isoDate = item.optString("isoDate").ifBlank { null },
          capturedAt = metadata.optString("captured_at").ifBlank { null },
          width = metadata.optInt("width"),
          height = metadata.optInt("height"),
          folder = metadata.optString("folder").ifBlank { null },
          originalInCloud = item.optBoolean("originalInCloud"),
          desktopHostDeviceId = item.optString("hostDeviceId").ifBlank { null },
          updatedAt = item.optString("updatedAt")
        )
      }

      val cursor = request(token, "GET", "/api/sync/entry-summary?libraryId=${encode(libraryId)}").optLong("cursor", 0)
      store.setState(CHANGE_CURSOR_KEY, cursor.toString())
      store.setState("last_sync_at", Instant.now().toString())
      store.setState("last_sync_result", JSONObject()
        .put("pushedEntries", pushed)
        .put("pulledEntries", pulled)
        .put("cloudMedia", media.length())
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
    return JSONObject().put("libraryId", libraryId).put("deviceId", deviceId)
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
