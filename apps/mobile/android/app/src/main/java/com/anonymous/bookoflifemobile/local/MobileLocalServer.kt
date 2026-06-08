package com.anonymous.bookoflifemobile.local

import android.content.Context
import android.net.Uri
import android.util.Log
import android.util.Size
import org.json.JSONObject
import org.json.JSONArray
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.HttpURLConnection
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.net.URLDecoder
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.concurrent.thread

object MobileLocalServer {
  const val PORT = 3199
  const val BASE_URL = "http://127.0.0.1:$PORT/"
  private const val TAG = "BookOfLifeLocalServer"
  private const val ASSET_ROOT = "mobile-web"
  private const val SUPABASE_URL = "https://mqbmkqikhqvhvwyaqemg.supabase.co"
  private const val SUPABASE_KEY = "sb_publishable_8xCIi6EckUw25Yg6R2hEDQ_gsc3i8_D"
  private const val STARTUP_MODE_KEY = "startup_mode"
  private const val CLOUD_SESSION_KEY = "cloud_session"

  @Volatile private var started = false
  @Volatile private var serverSocket: ServerSocket? = null
  private lateinit var appContext: Context
  private lateinit var store: MobileLocalStore

  fun start(context: Context) {
    if (started) return
    synchronized(this) {
      if (started) return
      appContext = context.applicationContext
      store = MobileLocalStore(appContext)
      serverSocket = ServerSocket(PORT, 50, InetAddress.getByName("127.0.0.1"))
      started = true
      thread(name = "book-of-life-local-http", isDaemon = true) {
        acceptLoop()
      }
      Log.i(TAG, "Started local HTTP service at $BASE_URL")
    }
  }

  fun ensureStarted(context: Context) = start(context)

  fun statusJson(): String {
    val payload = JSONObject()
      .put("ok", true)
      .put("mode", "android-local")
      .put("url", BASE_URL)
      .put("started", started)
      .put("entries", store.countEntries())
      .put("media", store.countMedia())
      .put("folders", store.countFolders())
      .put("pendingMutations", store.countPendingMutations())
      .put("lastSyncAt", store.lastSyncAt())
      .put("lastSyncResult", store.getState("last_sync_result")?.let { JSONObject(it) })
      .put("lastMediaScanAt", store.lastMediaScanAt())
      .put("lastMediaScanResult", store.getState("last_media_scan_result")?.let { JSONObject(it) })
      .put("cloudLibraryId", store.getState("cloud_library_id"))
      .put("cloudDeviceId", store.getState("cloud_device_id"))
      .put("generatedAt", Instant.now().toString())
    return payload.toString()
  }

  private fun acceptLoop() {
    while (started) {
      try {
        val socket = serverSocket?.accept() ?: break
        thread(name = "book-of-life-http-client", isDaemon = true) {
          handleSocket(socket)
        }
      } catch (error: Throwable) {
        if (started) Log.w(TAG, "Accept failed", error)
      }
    }
  }

  private fun handleSocket(socket: Socket) {
    socket.use { client ->
      client.soTimeout = 15_000
      val input = client.getInputStream()
      val output = client.getOutputStream()
      try {
        val headerBytes = readHeaders(input)
        if (headerBytes.isEmpty()) return
        val headerText = headerBytes.toString(StandardCharsets.UTF_8)
        val headerLines = headerText.split("\r\n")
        val requestLine = headerLines.firstOrNull().orEmpty()
        val requestParts = requestLine.split(" ")
        if (requestParts.size < 2) {
          writeText(output, 400, "text/plain; charset=utf-8", "Bad request")
          return
        }
        val method = requestParts[0].uppercase()
        val rawTarget = requestParts[1]
        val headers = parseHeaders(headerLines.drop(1))
        val contentLength = headers["content-length"]?.toIntOrNull() ?: 0
        val body = if (contentLength > 0) {
          input.readNBytes(contentLength).toString(StandardCharsets.UTF_8)
        } else {
          ""
        }
        val response = route(method, rawTarget, body)
        writeResponse(output, response)
      } catch (error: Throwable) {
        Log.w(TAG, "Request failed", error)
        writeText(output, 500, "application/json; charset=utf-8", """{"error":"Mobile local service failed."}""")
      }
    }
  }

  private fun route(method: String, rawTarget: String, body: String): LocalResponse {
        val uri = Uri.parse(rawTarget)
        // Android Uri treats the colon in mobile media IDs as a scheme separator.
        // Route using the raw request path while retaining Uri for query parameters.
        val path = normalizePath(rawTarget.substringBefore('?'))
    if (path.startsWith("/api/")) return routeApi(method, path, uri, body)
    if (method == "POST" && path == "/auth/logout") {
      store.removeState(CLOUD_SESSION_KEY)
      store.removeState(STARTUP_MODE_KEY)
      return json("""{"ok":true,"redirectTo":"/"}""")
    }
    if (method == "GET" && path.startsWith("/media/")) return serveMedia(path)
    return serveAsset(path)
  }

  private fun routeApi(method: String, path: String, uri: Uri, body: String): LocalResponse {
    if (method == "GET" && path == "/api/auth/status") {
      val session = cloudSession()
      return json("""{"ok":true,"enabled":true,"authenticated":${session != null},"username":${jsonNullable(session?.optJSONObject("user")?.optString("email"))},"mode":${jsonNullable(store.getState(STARTUP_MODE_KEY))}}""")
    }
    if (method == "GET" && path == "/api/bootstrap") return json(bootstrapJson())
    if (method == "GET" && path == "/api/timeline") return json(timelineJson())
    if (method == "GET" && path == "/api/gallery") return json(timelineJson(includeJournal = false))
    if (method == "GET" && path == "/api/gallery/index") return json("""{"total":0,"days":[]}""")
    if (method == "GET" && path == "/api/search") {
      return json(searchJson(uri.getQueryParameter("q") ?: ""))
    }
    if (method == "GET" && path.startsWith("/api/year/")) return json(yearJson(path.substringAfterLast('/')))
    if (method == "GET" && path.startsWith("/api/month/")) return json(monthJson(path.substringAfterLast('/')))
    if (method == "GET" && path == "/api/upload/folders") return json(folderRootsJson())
    if (method != "GET" && path.startsWith("/api/upload/")) return unsupported("Mobile media upload is not implemented in this local-only build.", 202)
    if (method == "GET" && path == "/api/folders/browse") {
      return json(folderBrowseJson(uri.getQueryParameter("rootId") ?: uri.getQueryParameter("root") ?: "", uri.getQueryParameter("path") ?: "."))
    }
    if (method == "GET" && path == "/api/mobile/status") return json(statusJson())
    if (method == "POST" && path == "/api/mobile/sync-now") {
      store.setState("last_sync_requested_at", Instant.now().toString())
      MobileBackgroundScheduler.syncNow(appContext)
      return json("""{"ok":true,"queued":true}""")
    }
    if (method == "POST" && path == "/api/mobile/scan-now") {
      store.setState("last_media_scan_requested_at", Instant.now().toString())
      MobileBackgroundScheduler.scanNow(appContext)
      return json("""{"ok":true,"queued":true}""")
    }
    if (method == "POST" && path == "/api/mobile/use-local") {
      store.setState(STARTUP_MODE_KEY, "local")
      return json("""{"ok":true,"mode":"local","redirectTo":"/"}""")
    }
    if (path.startsWith("/api/entry/")) return routeEntry(method, path, uri, body)
    if (path.startsWith("/api/media/")) return unsupported("Mobile media operations are not implemented in this local-only build.", if (method == "GET") 404 else 202)
    if (path.startsWith("/api/desktop/")) return routeDesktopApi(method, path, body)
    if (path.startsWith("/api/sync/")) return unsupported("Mobile sync is not implemented in this local-only build.", 404)
    return json("""{"error":"Mobile API route not implemented yet.","path":"${escapeJson(path)}"}""", status = 404)
  }

  private fun routeDesktopApi(method: String, path: String, body: String): LocalResponse {
    if (method == "GET" && path == "/api/desktop/sync-settings") return json("""{"settings":${desktopSettingsJson()}}""")
    if (method == "POST" && path == "/api/desktop/sync-settings") return json("""{"ok":true,"settings":${desktopSettingsJson()},"ignored":true,"mode":"android-local"}""")
    if (method == "GET" && path == "/api/desktop/cloud/status") return json(desktopCloudStatusJson())
    if (method == "POST" && path == "/api/desktop/cloud/connect") return cloudAuth(body, signup = false)
    if (method == "POST" && path == "/api/desktop/cloud/signup") return cloudAuth(body, signup = true)
    if (method == "POST" && path == "/api/desktop/cloud/sync") return unsupported("Cloud sync is not implemented in this local-only mobile build.", 202)
    if (method == "GET" && path == "/api/desktop/index/status") return json(desktopIndexStatusJson())
    if (method == "POST" && path == "/api/desktop/index/rebuild") return unsupported("Mobile indexing is not implemented in this local-only build.", 202)
    if (method == "GET" && path == "/api/desktop/tray/status") return json(desktopTrayStatusJson())
    if (method == "GET" && path == "/api/desktop/onboarding/status") return json(desktopOnboardingStatusJson())
    if (method == "POST" && path == "/api/desktop/onboarding/complete") return json("""{"ok":true,"complete":true,"settings":${desktopSettingsJson()},"mode":"android-local"}""")
    if (path.startsWith("/api/desktop/relay/")) return unsupported("Desktop media relay is not available on mobile.", 404)
    return unsupported("Desktop-only API is not available in the mobile local shell.", if (method == "GET") 404 else 202)
  }

  private fun routeEntry(method: String, path: String, uri: Uri, body: String): LocalResponse {
    val isoDate = path.substringAfter("/api/entry/").substringBefore("/")
    if (!isIsoDate(isoDate)) return json("""{"error":"Invalid entry date."}""", status = 400)
    if (method == "GET") {
      val entry = store.getEntry(isoDate)
      if (entry == null) {
        val create = uri.getQueryParameter("create") == "1"
        if (!create) return json("""{"error":"Entry not found."}""", status = 404)
        return json("""{"isoDate":"$isoDate","raw":"","title":"","cloudVersion":0,"source":"mobile-local"}""")
      }
      return json(entryJson(entry))
    }
    if (method == "POST") {
      val raw = try {
        JSONObject(body.ifBlank { "{}" }).optString("raw", "")
      } catch (_: Throwable) {
        ""
      }
      val entry = store.saveEntry(isoDate, raw)
      return json("""{"ok":true,"isoDate":"$isoDate","day":${dayJson(entry)},"removed":false,"cloudEntry":${entryJson(entry)},"conflict":false}""")
    }
    return json("""{"error":"Method not allowed."}""", status = 405)
  }

  private fun serveAsset(path: String): LocalResponse {
    val assetPath = when {
      path == "/" && store.getState(STARTUP_MODE_KEY).isNullOrBlank() -> "$ASSET_ROOT/desktop-onboarding.html"
      path == "/" -> "$ASSET_ROOT/index.html"
      path == "/login" -> "$ASSET_ROOT/login.html"
      path.startsWith("/edit/") -> "$ASSET_ROOT/editor.html"
      path.startsWith("/desktop/settings") -> "$ASSET_ROOT/desktop-settings.html"
      path.startsWith("/desktop/onboarding") -> "$ASSET_ROOT/desktop-onboarding.html"
      path.startsWith("/desktop/tray") -> "$ASSET_ROOT/desktop-tray.html"
      path.contains('.') -> "$ASSET_ROOT/${path.trimStart('/')}"
      else -> "$ASSET_ROOT/index.html"
    }
    if (".." in assetPath) return LocalResponse(400, "text/plain; charset=utf-8", "Bad asset path".toByteArray())
    return try {
      val bytes = appContext.assets.open(assetPath).use { input ->
        input.readBytes()
      }
      LocalResponse(200, mimeType(assetPath), bytes, cacheStatic = !assetPath.endsWith(".html"))
    } catch (_: Throwable) {
      LocalResponse(404, "text/plain; charset=utf-8", "Not found".toByteArray())
    }
  }

  private fun bootstrapJson(): String {
    val today = LocalDate.now().format(DateTimeFormatter.ISO_DATE)
    val entries = store.listEntries(10_000)
    val entriesByDate = entries.associateBy { it.isoDate }
    val mediaByDate = store.listMedia().filter { isIsoDate(it.isoDate.orEmpty()) && (it.localUri == null || it.mediaType != "video") }.groupBy { it.isoDate!! }
    val dates = (entriesByDate.keys + mediaByDate.keys).distinct().sortedDescending()
    val days = dates.map { dayJson(entriesByDate[it], mediaByDate[it].orEmpty(), it) }
    val totalWords = entries.sumOf { wordCount(it.raw) }
    return """
      {
        "generatedAt":"${Instant.now()}",
        "totalDays":${dates.size},
        "totalEntries":${store.countEntries()},
        "totalWords":$totalWords,
        "totalMedia":${store.countMedia()},
        "firstDate":${jsonNullable(dates.lastOrNull())},
        "lastDate":${jsonNullable(dates.firstOrNull())},
        "today":${dayJson(entriesByDate[today], mediaByDate[today].orEmpty(), today)},
        "years":[${yearSummariesJson(dates, entriesByDate, mediaByDate)}],
        "monthsByYear":[${monthsByYearJson(dates, entriesByDate, mediaByDate)}],
        "railDates":[${railDatesJson(dates, entriesByDate, mediaByDate)}],
        "days":[${days.joinToString(",")}],
        "chunkSize":24,
        "mobile":{"mode":"android-local","statusUrl":"/api/mobile/status"}
      }
    """.trimIndent()
  }

  private fun timelineJson(includeJournal: Boolean = true): String {
    val entries = store.listEntries(10_000).associateBy { it.isoDate }
    val media = store.listMedia().filter { isIsoDate(it.isoDate.orEmpty()) && (it.localUri == null || it.mediaType != "video") }.groupBy { it.isoDate!! }
    val dates = (entries.keys + media.keys).distinct().sortedDescending()
    val days = dates.map { dayJson(if (includeJournal) entries[it] else null, media[it].orEmpty(), it) }
    return """
      {
        "total":${days.size},
        "startIndex":0,
        "endIndex":${days.size - 1},
        "hasOlder":false,
        "hasNewer":false,
        "days":[${days.joinToString(",")}]
      }
    """.trimIndent()
  }

  private fun searchJson(rawQuery: String): String {
    val query = rawQuery.trim()
    val matches = if (query.isBlank()) {
      emptyList()
    } else {
      store.listEntries(10_000).filter {
        it.isoDate.contains(query, ignoreCase = true) ||
          it.title.contains(query, ignoreCase = true) ||
          it.raw.contains(query, ignoreCase = true)
      }
    }
    return """{"query":"${escapeJson(query)}","total":${matches.size},"days":[${matches.joinToString(",") { dayJson(it) }}],"folders":[]}"""
  }

  private fun yearJson(year: String): String {
    val cleanYear = year.take(4)
    val entries = store.listEntries(10_000).filter { it.isoDate.startsWith(cleanYear) }.associateBy { it.isoDate }
    val media = store.listMedia().filter { it.isoDate?.startsWith(cleanYear) == true && (it.localUri == null || it.mediaType != "video") }.groupBy { it.isoDate!! }
    val dates = (entries.keys + media.keys).distinct().sortedDescending()
    return """{"year":${cleanYear.toIntOrNull() ?: 0},"months":[${monthSummariesJson(dates, entries, media)}]}"""
  }

  private fun monthJson(monthKey: String): String {
    val cleanMonth = monthKey.take(7)
    val entries = store.listEntries(10_000).filter { it.isoDate.startsWith(cleanMonth) }.associateBy { it.isoDate }
    val media = store.listMedia().filter { it.isoDate?.startsWith(cleanMonth) == true && (it.localUri == null || it.mediaType != "video") }.groupBy { it.isoDate!! }
    val dates = (entries.keys + media.keys).distinct().sortedDescending()
    val summary = monthSummaryJson(cleanMonth, dates, entries, media, includeDays = true)
    return summary
  }

  private fun desktopStatusJson(): String {
    return """
      {
        "ok":true,
        "mode":"android-local",
        "complete":true,
        "server":{"url":"$BASE_URL"},
        "settings":{"storageMode":"device_only","mediaFolders":[]},
        "cloudStatus":{"signedIn":false},
        "indexStatus":{"state":"idle","running":false,"reason":"mobile-local","startedAt":null,"finishedAt":null},
        "mediaAvailability":{"roots":[]},
        "storageUsage":{"cacheBytes":0},
        "syncStatus":{"pendingMutations":${store.countPendingMutations()},"lastSyncAt":${jsonNullable(store.lastSyncAt())}}
      }
    """.trimIndent()
  }

  private fun desktopSettingsJson(): String {
    return """
      {
        "desktopName":"Book of Life Mobile",
        "libraryName":"Book of Life",
        "storageMode":"device-only",
        "mediaFolders":[],
        "deviceUploadRootId":"0",
        "deviceUploadFolderName":"Device Uploads",
        "cloudSession":null,
        "updatedAt":"${Instant.now()}"
      }
    """.trimIndent()
  }

  private fun desktopCloudStatusJson(): String {
    val session = cloudSession()
    val signedIn = session != null
    val email = session?.optJSONObject("user")?.optString("email").orEmpty()
    return """
      {
        "configured":true,
        "signedIn":$signedIn,
        "email":"${escapeJson(email)}",
        "mode":"android-local",
        "error":null
      }
    """.trimIndent()
  }

  private fun desktopIndexStatusJson(): String {
    return """{"state":"idle","running":false,"reason":"mobile-local","startedAt":null,"finishedAt":null}"""
  }

  private fun desktopTrayStatusJson(): String {
    return """
      {
        "ok":true,
        "mode":"android-local",
        "service":{"running":true,"url":"$BASE_URL"},
        "server":{"url":"$BASE_URL"},
        "cloud":{"configured":false,"signedIn":false},
        "sync":{"running":false,"queued":false,"pendingMutations":${store.countPendingMutations()},"lastSyncedAt":${jsonNullable(store.lastSyncAt())}},
        "mediaAvailability":{"warningCount":0,"roots":[]},
        "storageUsage":{"cacheBytes":0},
        "generatedAt":"${Instant.now()}"
      }
    """.trimIndent()
  }

  private fun desktopOnboardingStatusJson(): String {
    return """
      {
        "complete":${!store.getState(STARTUP_MODE_KEY).isNullOrBlank()},
        "mode":"android-local",
        "settings":${desktopSettingsJson()},
        "cloud":${desktopCloudStatusJson()},
        "index":${desktopIndexStatusJson()},
        "server":{"url":"$BASE_URL"}
      }
    """.trimIndent()
  }

  private fun cloudSession(): JSONObject? {
    val raw = store.getState(CLOUD_SESSION_KEY) ?: return null
    return try {
      JSONObject(raw)
    } catch (_: Throwable) {
      null
    }
  }

  private fun cloudAuth(body: String, signup: Boolean): LocalResponse {
    val request = try {
      JSONObject(body.ifBlank { "{}" })
    } catch (_: Throwable) {
      JSONObject()
    }
    val email = request.optString("email", "").trim()
    val password = request.optString("password", "")
    if (email.isBlank() || password.isBlank()) {
      return json("""{"error":"Enter your email and password."}""", status = 400)
    }

    return try {
      val endpoint = if (signup) "/auth/v1/signup" else "/auth/v1/token?grant_type=password"
      val connection = URL("$SUPABASE_URL$endpoint").openConnection() as HttpURLConnection
      connection.requestMethod = "POST"
      connection.connectTimeout = 15_000
      connection.readTimeout = 20_000
      connection.doOutput = true
      connection.setRequestProperty("apikey", SUPABASE_KEY)
      connection.setRequestProperty("Content-Type", "application/json")
      val payload = JSONObject().put("email", email).put("password", password).toString()
      connection.outputStream.use { it.write(payload.toByteArray(StandardCharsets.UTF_8)) }
      val status = connection.responseCode
      val responseText = (if (status in 200..299) connection.inputStream else connection.errorStream)
        ?.bufferedReader(StandardCharsets.UTF_8)
        ?.use { it.readText() }
        .orEmpty()
      val response = JSONObject(responseText.ifBlank { "{}" })
      if (status !in 200..299) {
        val message = response.optString("msg", response.optString("error_description", response.optString("message", "Cloud sign in failed.")))
        return json("""{"error":"${escapeJson(message)}"}""", status = 400)
      }
      if (response.optString("access_token").isBlank()) {
        val message = if (signup) {
          "Check your email to confirm the account, then log in."
        } else {
          "Cloud sign in did not return a session."
        }
        return json("""{"error":"${escapeJson(message)}"}""", status = 400)
      }
      store.setState(CLOUD_SESSION_KEY, response.toString())
      store.setState(STARTUP_MODE_KEY, "cloud")
      MobileBackgroundScheduler.syncNow(appContext)
      MobileBackgroundScheduler.scanNow(appContext)
      json("""{"ok":true,"mode":"android-local","redirectTo":"/","settings":${desktopSettingsJson()},"cloud":${desktopCloudStatusJson()}}""")
    } catch (error: Throwable) {
      Log.w(TAG, "Cloud authentication failed", error)
      json("""{"error":"Could not reach Book of Life Cloud. Check your internet connection and try again."}""", status = 400)
    }
  }

  private fun emptyChunkJson(): String = """{"total":0,"startIndex":0,"endIndex":-1,"hasOlder":false,"hasNewer":false,"days":[]}"""

  private fun emptyDayJson(isoDate: String): String {
    return """
      {
        "isoDate":"$isoDate",
        "dateLabel":"${escapeJson(longDateLabel(isoDate))}",
        "hasTimelineItem":false,
        "hasJournal":false,
        "wordCount":0,
        "photoCount":0,
        "photos":[],
        "previewText":"",
        "previewLines":[],
        "isPreviewTruncated":false
      }
    """.trimIndent()
  }

  private fun dayJson(entry: MobileEntryRecord): String {
    return dayJson(entry, emptyList(), entry.isoDate)
  }

  private fun dayJson(entry: MobileEntryRecord?, media: List<MobileMediaRecord>, isoDate: String): String {
    if (entry == null && media.isEmpty()) return emptyDayJson(isoDate)
    val raw = entry?.raw.orEmpty()
    val words = wordCount(raw)
    val preview = raw.lineSequence().firstOrNull { it.isNotBlank() }.orEmpty().take(180)
    return """
      {
        "isoDate":"$isoDate",
        "dateLabel":"${escapeJson(longDateLabel(isoDate))}",
        "monthKey":"${isoDate.take(7)}",
        "monthLabel":"${escapeJson(monthLabel(isoDate))}",
        "hasTimelineItem":true,
        "hasJournal":${raw.isNotBlank()},
        "wordCount":$words,
        "photoCount":${media.size},
        "photos":[${media.joinToString(",") { mediaJson(it) }}],
        "previewText":"${escapeJson(preview)}",
        "previewLines":["${escapeJson(preview)}"],
        "isPreviewTruncated":${raw.length > preview.length},
        "journal":${if (entry == null) "null" else """{"raw":"${escapeJson(raw)}","title":"${escapeJson(entry.title)}","previewText":"${escapeJson(preview)}","previewLines":["${escapeJson(preview)}"],"isPreviewTruncated":${raw.length > preview.length},"fullHtml":"${escapeJson(raw)}","wordCount":$words}"""}
      }
    """.trimIndent()
  }

  private fun yearSummariesJson(
    dates: List<String>,
    entries: Map<String, MobileEntryRecord>,
    media: Map<String, List<MobileMediaRecord>>
  ): String {
    return dates.groupBy { it.take(4) }.entries.joinToString(",") { (year, yearDates) ->
      val covers = yearDates.flatMap { media[it].orEmpty() }.take(4)
      """{"year":${year.toIntOrNull() ?: 0},"firstDate":"${yearDates.last()}","journalCount":${yearDates.count { entries[it] != null }},"photoCount":${yearDates.sumOf { media[it].orEmpty().size }},"coverPhotoIds":[${covers.joinToString(",") { """"${escapeJson(it.id)}"""" }}],"coverUrls":[${covers.joinToString(",") { """"/media/thumb/${escapeJson(it.id)}"""" }}]}"""
    }
  }

  private fun monthsByYearJson(
    dates: List<String>,
    entries: Map<String, MobileEntryRecord>,
    media: Map<String, List<MobileMediaRecord>>
  ): String {
    return dates.groupBy { it.take(4) }.entries.joinToString(",") { (year, yearDates) ->
      """{"year":${year.toIntOrNull() ?: 0},"months":[${monthSummariesJson(yearDates, entries, media)}]}"""
    }
  }

  private fun monthSummariesJson(
    dates: List<String>,
    entries: Map<String, MobileEntryRecord>,
    media: Map<String, List<MobileMediaRecord>>
  ): String {
    return dates.groupBy { it.take(7) }.entries.joinToString(",") { (month, monthDates) ->
      monthSummaryJson(month, monthDates, entries, media)
    }
  }

  private fun monthSummaryJson(
    month: String,
    dates: List<String>,
    entries: Map<String, MobileEntryRecord>,
    media: Map<String, List<MobileMediaRecord>>,
    includeDays: Boolean = false
  ): String {
    val covers = dates.flatMap { media[it].orEmpty() }.take(4)
    val days = if (includeDays) {
      dates.joinToString(",") { isoDate ->
        val previews = media[isoDate].orEmpty().take(4)
        """{"isoDate":"$isoDate","dateLabel":"${escapeJson(longDateLabel(isoDate))}","shortLabel":"${escapeJson(shortDateLabel(isoDate))}","photoCount":${media[isoDate].orEmpty().size},"hasJournal":${entries[isoDate] != null},"wordCount":${wordCount(entries[isoDate]?.raw.orEmpty())},"previewThumbs":[${previews.joinToString(",") { """{"id":"${escapeJson(it.id)}","type":"${if (it.mediaType == "video") "video" else "photo"}","thumbUrl":"/media/thumb/${escapeJson(it.id)}","previewUrl":"/media/preview/${escapeJson(it.id)}"}""" }}]}"""
      }
    } else {
      ""
    }
    return """{"key":"${escapeJson(month)}","year":${month.take(4).toIntOrNull() ?: 0},"monthIndex":${(month.takeLast(2).toIntOrNull() ?: 1) - 1},"label":"${escapeJson(monthLabel("$month-01"))}","firstDate":"${dates.last()}","journalCount":${dates.count { entries[it] != null }},"photoCount":${dates.sumOf { media[it].orEmpty().size }},"coverPhotoIds":[${covers.joinToString(",") { """"${escapeJson(it.id)}"""" }}],"coverUrls":[${covers.joinToString(",") { """"/media/thumb/${escapeJson(it.id)}"""" }}]${if (includeDays) ""","days":[$days]""" else ""}}"""
  }

  private fun railDatesJson(
    dates: List<String>,
    entries: Map<String, MobileEntryRecord>,
    media: Map<String, List<MobileMediaRecord>>
  ): String {
    val total = dates.size
    return dates.mapIndexed { descendingIndex, isoDate ->
      """{"index":${total - descendingIndex - 1},"isoDate":"$isoDate","label":"${escapeJson(shortDateLabel(isoDate))}","longLabel":"${escapeJson(longDateLabel(isoDate))}","hasJournal":${entries[isoDate] != null},"photoCount":${media[isoDate].orEmpty().size}}"""
    }.joinToString(",")
  }

  private fun parsedDate(isoDate: String): LocalDate? = try {
    LocalDate.parse(isoDate.take(10), DateTimeFormatter.ISO_DATE)
  } catch (_: Throwable) {
    null
  }

  private fun longDateLabel(isoDate: String): String =
    parsedDate(isoDate)?.format(DateTimeFormatter.ofPattern("EEEE, MMMM d, yyyy", Locale.US)) ?: isoDate

  private fun shortDateLabel(isoDate: String): String =
    parsedDate(isoDate)?.format(DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US)) ?: isoDate

  private fun monthLabel(isoDate: String): String =
    parsedDate(isoDate)?.format(DateTimeFormatter.ofPattern("MMMM yyyy", Locale.US)) ?: isoDate.take(7)

  private fun mediaJson(media: MobileMediaRecord): String {
    val type = if (media.mediaType == "video") "video" else "photo"
    val locations = mediaLocations(media)
    val currentDeviceId = store.getState("cloud_device_id").orEmpty()
    val selected = (0 until locations.length()).map { locations.getJSONObject(it) }
      .firstOrNull { it.optString("deviceId") == currentDeviceId }
      ?: locations.optJSONObject(0)
    val fileName = selected?.optString("fileName").orEmpty().ifBlank { media.fileName }.ifBlank {
      if (media.mediaType == "video") "Untitled video.mp4" else "Untitled photo.jpg"
    }
    val ext = fileName.substringAfterLast('.', "").let { if (it.isBlank()) "" else ".$it" }
    val baseName = if (ext.isBlank()) fileName else fileName.dropLast(ext.length)
    val relativePath = selected?.optString("relativePath").orEmpty()
    val relativeFolder = relativePath.substringBeforeLast('/', "").ifBlank { media.folder.orEmpty().trim('/') }
    val rootLabel = selected?.optString("deviceName").orEmpty().ifBlank { "Device" }
    val rootId = selected?.optString("deviceId").orEmpty()
    val storageLabel = selected?.optString("storageRootLabel").orEmpty()
    val folder = listOf(storageLabel, relativeFolder).filter { it.isNotBlank() }.joinToString("/").ifBlank { "." }
    return """{"id":"${escapeJson(media.id)}","fileName":"${escapeJson(fileName)}","baseName":"${escapeJson(baseName)}","ext":"${escapeJson(ext)}","type":"$type","isoDate":"${escapeJson(media.isoDate.orEmpty())}","capturedAt":"${escapeJson(media.capturedAt.orEmpty())}","width":${media.width},"height":${media.height},"folder":"${escapeJson(folder)}","folderRootId":"${escapeJson(rootId)}","folderRootLabel":"${escapeJson(rootLabel)}","relativePath":"${escapeJson(relativePath)}","locations":$locations,"canEditMedia":false,"thumbUrl":"/media/thumb/${escapeJson(media.id)}","previewUrl":"/media/preview/${escapeJson(media.id)}","displayUrl":"/media/display/${escapeJson(media.id)}","fullUrl":"/media/full/${escapeJson(media.id)}","originalAvailable":${media.localUri != null || media.originalInCloud},"cloudOriginal":{"inCloud":${media.originalInCloud}}}"""
  }

  private fun mediaLocations(media: MobileMediaRecord): JSONArray = try {
    JSONArray(media.locationsJson.ifBlank { "[]" })
  } catch (_: Throwable) {
    JSONArray()
  }

  private fun allLocations(): List<Pair<MobileMediaRecord, JSONObject>> =
    store.listMedia().flatMap { media ->
      val locations = mediaLocations(media)
      (0 until locations.length()).map { media to locations.getJSONObject(it) }
    }

  private fun folderRootsJson(): String {
    val roots = allLocations().map { it.second }.filter { it.optString("deviceId").isNotBlank() }
      .distinctBy { it.optString("deviceId") }
    return JSONObject().put("roots", JSONArray(roots.map { location ->
      val rootId = location.optString("deviceId")
      val label = location.optString("deviceName").ifBlank { "Device" }
      JSONObject()
        .put("rootId", rootId)
        .put("rootLabel", label)
        .put("tree", JSONObject()
          .put("label", label)
          .put("relativePath", "")
          .put("displayPath", ".")
          .put("children", JSONArray())
          .put("icon", "hard-drives"))
    })).toString()
  }

  private fun folderBrowseJson(rootId: String, requestedPath: String): String {
    val cleanPath = requestedPath.trim('/').takeUnless { it == "." }.orEmpty()
    val matches = allLocations().filter { (_, location) -> location.optString("deviceId") == rootId }
    val rootLabel = matches.firstOrNull()?.second?.optString("deviceName").orEmpty().ifBlank { "Device" }
    val folders = linkedSetOf<String>()
    val media = JSONArray()
    for ((record, location) in matches) {
      val storage = location.optString("storageRootLabel")
      val relativeFile = location.optString("relativePath").trim('/')
      val displayFile = listOf(storage, relativeFile).filter { it.isNotBlank() }.joinToString("/")
      val parent = displayFile.substringBeforeLast('/', "")
      if (parent == cleanPath) {
        media.put(JSONObject(mediaJson(record)))
      } else if (parent.startsWith(if (cleanPath.isBlank()) "" else "$cleanPath/")) {
        val remainder = parent.removePrefix(if (cleanPath.isBlank()) "" else "$cleanPath/").substringBefore('/')
        if (remainder.isNotBlank()) folders.add(listOf(cleanPath, remainder).filter { it.isNotBlank() }.joinToString("/"))
      }
    }
    val folderJson = JSONArray(folders.map { folder ->
      JSONObject().put("label", folder.substringAfterLast('/')).put("relativePath", folder).put("displayPath", folder).put("mediaCount", 0)
    })
    val breadcrumbs = JSONArray().put(JSONObject().put("label", rootLabel).put("relativePath", ""))
    var path = ""
    cleanPath.split('/').filter { it.isNotBlank() }.forEach { part ->
      path = listOf(path, part).filter { it.isNotBlank() }.joinToString("/")
      breadcrumbs.put(JSONObject().put("label", part).put("relativePath", path))
    }
    return JSONObject()
      .put("rootId", rootId)
      .put("rootLabel", rootLabel)
      .put("relativePath", cleanPath.ifBlank { "." })
      .put("breadcrumbs", breadcrumbs)
      .put("folders", folderJson)
      .put("media", media)
      .toString()
  }

  private fun serveMedia(path: String): LocalResponse {
    val parts = path.trim('/').split('/', limit = 3)
    if (parts.size < 3) return json("""{"error":"Invalid media path."}""", status = 400)
    val variant = parts[1]
    val media = store.getMedia(parts[2]) ?: return json("""{"error":"Media not found."}""", status = 404)
    if (media.localUri != null) {
      return try {
        if (variant == "thumb" || variant == "preview") {
          val thumbnail = appContext.contentResolver.loadThumbnail(Uri.parse(media.localUri), Size(640, 640), null)
          val output = ByteArrayOutputStream()
          thumbnail.compress(android.graphics.Bitmap.CompressFormat.JPEG, 82, output)
          thumbnail.recycle()
          return LocalResponse(200, "image/jpeg", output.toByteArray(), cacheStatic = true)
        }
        val bytes = appContext.contentResolver.openInputStream(Uri.parse(media.localUri))?.use { it.readBytes() }
          ?: return json("""{"error":"Local media unavailable."}""", status = 404)
        LocalResponse(200, if (media.mediaType == "video") "video/mp4" else "image/jpeg", bytes, cacheStatic = true)
      } catch (_: Throwable) {
        json("""{"error":"Local media unavailable."}""", status = 404)
      }
    }
    val cloudId = media.cloudId ?: return json("""{"error":"Cloud media unavailable."}""", status = 404)
    val token = MobileCloudSync.accessToken(store) ?: return json("""{"error":"Sign in required."}""", status = 401)
    val cloudVariant = if (variant == "display") "full" else variant
    return try {
      val connection = URL("https://book-of-life-two.vercel.app/api/media/${URLEncoder.encode(cloudId, StandardCharsets.UTF_8.name())}/variant/$cloudVariant?libraryId=${URLEncoder.encode(store.getState("cloud_library_id").orEmpty(), StandardCharsets.UTF_8.name())}").openConnection() as HttpURLConnection
      connection.setRequestProperty("Authorization", "Bearer $token")
      connection.connectTimeout = 20_000
      connection.readTimeout = 30_000
      val status = connection.responseCode
      if (status !in 200..299) return json("""{"error":"Cloud media unavailable."}""", status = 404)
      LocalResponse(200, connection.contentType ?: "application/octet-stream", connection.inputStream.use { it.readBytes() }, cacheStatic = true)
    } catch (_: Throwable) {
      json("""{"error":"Cloud media unavailable."}""", status = 404)
    }
  }

  private fun mediaOnlyDayJson(entry: MobileEntryRecord): String {
    return """
      {
        "isoDate":"${entry.isoDate}",
        "dateLabel":"${entry.isoDate}",
        "monthKey":"${entry.isoDate.take(7)}",
        "monthLabel":"${entry.isoDate.take(7)}",
        "hasTimelineItem":true,
        "hasJournal":${entry.raw.isNotBlank()},
        "wordCount":${wordCount(entry.raw)},
        "photoCount":0,
        "photos":[],
        "previewText":"",
        "previewLines":[],
        "isPreviewTruncated":false
      }
    """.trimIndent()
  }

  private fun entryJson(entry: MobileEntryRecord): String {
    return """
      {
        "isoDate":"${entry.isoDate}",
        "raw":"${escapeJson(entry.raw)}",
        "title":"${escapeJson(entry.title)}",
        "cloudVersion":${entry.cloudVersion},
        "updatedAt":"${escapeJson(entry.updatedAt)}",
        "updatedByDeviceId":"android-local",
        "source":"mobile-local"
      }
    """.trimIndent()
  }

  private fun readHeaders(input: java.io.InputStream): ByteArray {
    val buffer = ByteArrayOutputStream()
    var previous3 = -1
    var previous2 = -1
    var previous1 = -1
    while (true) {
      val current = input.read()
      if (current == -1) break
      buffer.write(current)
      if (previous3 == '\r'.code && previous2 == '\n'.code && previous1 == '\r'.code && current == '\n'.code) break
      previous3 = previous2
      previous2 = previous1
      previous1 = current
      if (buffer.size() > 64 * 1024) break
    }
    return buffer.toByteArray()
  }

  private fun parseHeaders(lines: List<String>): Map<String, String> {
    val headers = mutableMapOf<String, String>()
    for (line in lines) {
      val index = line.indexOf(':')
      if (index <= 0) continue
      headers[line.substring(0, index).trim().lowercase()] = line.substring(index + 1).trim()
    }
    return headers
  }

  private fun normalizePath(path: String): String {
    val decoded = URLDecoder.decode(path, StandardCharsets.UTF_8.name())
    val clean = decoded.replace('\\', '/').replace(Regex("/{2,}"), "/")
    return if (clean.startsWith("/")) clean else "/$clean"
  }

  private fun isIsoDate(value: String): Boolean = Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(value)

  private fun wordCount(raw: String): Int = raw.split(Regex("\\s+")).count { it.isNotBlank() }

  private fun json(value: String, status: Int = 200): LocalResponse {
    return LocalResponse(status, "application/json; charset=utf-8", value.toByteArray(StandardCharsets.UTF_8))
  }

  private fun unsupported(message: String, status: Int): LocalResponse {
    return json("""{"ok":false,"unsupported":true,"mode":"android-local","error":"${escapeJson(message)}"}""", status = status)
  }

  private fun jsonNullable(value: String?): String = if (value == null) "null" else """"${escapeJson(value)}""""

  private fun writeText(output: java.io.OutputStream, status: Int, contentType: String, text: String) {
    writeResponse(output, LocalResponse(status, contentType, text.toByteArray(StandardCharsets.UTF_8)))
  }

  private fun writeResponse(output: java.io.OutputStream, response: LocalResponse) {
    val statusText = when (response.status) {
      200 -> "OK"
      202 -> "Accepted"
      400 -> "Bad Request"
      404 -> "Not Found"
      405 -> "Method Not Allowed"
      500 -> "Internal Server Error"
      else -> "OK"
    }
    val cache = if (response.cacheStatic) "public, max-age=600" else "no-store"
    val header = buildString {
      append("HTTP/1.1 ${response.status} $statusText\r\n")
      append("Content-Type: ${response.contentType}\r\n")
      append("Content-Length: ${response.body.size}\r\n")
      append("Cache-Control: $cache\r\n")
      append("Access-Control-Allow-Origin: *\r\n")
      append("Connection: close\r\n")
      append("\r\n")
    }
    output.write(header.toByteArray(StandardCharsets.UTF_8))
    output.write(response.body)
    output.flush()
  }

  private fun mimeType(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
    "html" -> "text/html; charset=utf-8"
    "js" -> "text/javascript; charset=utf-8"
    "css" -> "text/css; charset=utf-8"
    "json" -> "application/json; charset=utf-8"
    "svg" -> "image/svg+xml"
    "png" -> "image/png"
    "jpg", "jpeg" -> "image/jpeg"
    "webp" -> "image/webp"
    "ico" -> "image/x-icon"
    "woff2" -> "font/woff2"
    else -> "application/octet-stream"
  }
}

data class LocalResponse(
  val status: Int,
  val contentType: String,
  val body: ByteArray,
  val cacheStatic: Boolean = false
)
