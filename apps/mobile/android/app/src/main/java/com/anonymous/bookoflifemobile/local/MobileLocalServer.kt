package com.anonymous.bookoflifemobile.local

import android.content.Context
import android.net.Uri
import android.util.Log
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import kotlin.concurrent.thread

object MobileLocalServer {
  const val PORT = 3199
  const val BASE_URL = "http://127.0.0.1:$PORT/"
  private const val TAG = "BookOfLifeLocalServer"
  private const val ASSET_ROOT = "mobile-web"

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
      .put("lastMediaScanAt", store.lastMediaScanAt())
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
        val headerText = headerBytes.toString(StandardCharsets.UTF_8.name())
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
    val path = normalizePath(uri.path ?: "/")
    if (path.startsWith("/api/")) return routeApi(method, path, uri, body)
    if (path.startsWith("/media/")) return LocalResponse(404, "application/json; charset=utf-8", """{"error":"Media not cached on this phone yet."}""".toByteArray())
    return serveAsset(path)
  }

  private fun routeApi(method: String, path: String, uri: Uri, body: String): LocalResponse {
    if (method == "GET" && path == "/api/auth/status") {
      return json("""{"ok":true,"enabled":false,"authenticated":true,"username":"mobile-local"}""")
    }
    if (method == "GET" && path == "/api/bootstrap") return json(bootstrapJson())
    if (method == "GET" && path == "/api/timeline") return json(emptyChunkJson())
    if (method == "GET" && path == "/api/gallery") return json(emptyChunkJson())
    if (method == "GET" && path == "/api/gallery/index") return json("""{"total":0,"days":[]}""")
    if (method == "GET" && path == "/api/search") {
      val query = escapeJson(uri.getQueryParameter("q") ?: "")
      return json("""{"query":"$query","total":0,"days":[],"folders":[]}""")
    }
    if (method == "GET" && path.startsWith("/api/year/")) return json("""{"year":"${escapeJson(path.substringAfterLast('/'))}","months":[],"days":[]}""")
    if (method == "GET" && path.startsWith("/api/month/")) return json("""{"monthKey":"${escapeJson(path.substringAfterLast('/'))}","days":[]}""")
    if (method == "GET" && path == "/api/upload/folders") return json("""{"roots":[]}""")
    if (method == "GET" && path == "/api/folders/browse") {
      return json("""{"rootId":"0","rootLabel":"Phone","relativePath":".","folders":[],"media":[]}""")
    }
    if (method == "GET" && path == "/api/mobile/status") return json(statusJson())
    if (method == "POST" && path == "/api/mobile/sync-now") {
      store.setState("last_sync_requested_at", Instant.now().toString())
      return json("""{"ok":true,"queued":true}""")
    }
    if (method == "POST" && path == "/api/mobile/scan-now") {
      store.setState("last_media_scan_requested_at", Instant.now().toString())
      return json("""{"ok":true,"queued":true}""")
    }
    if (path.startsWith("/api/entry/")) return routeEntry(method, path, uri, body)
    if (path.startsWith("/api/media/")) return json("""{"ok":false,"queued":true,"pending":true}""", status = if (method == "GET") 404 else 202)
    if (path.startsWith("/api/desktop/")) return json(desktopStatusJson())
    if (path.startsWith("/api/sync/")) return json("""{"ok":true,"changes":[],"entries":[],"media":[],"cursor":null}""")
    return json("""{"error":"Mobile API route not implemented yet.","path":"${escapeJson(path)}"}""", status = 404)
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
    return """
      {
        "generatedAt":"${Instant.now()}",
        "totalDays":0,
        "totalEntries":${store.countEntries()},
        "totalWords":0,
        "totalMedia":${store.countMedia()},
        "firstDate":null,
        "lastDate":null,
        "today":${emptyDayJson(today)},
        "years":[],
        "monthsByYear":[],
        "railDates":[],
        "chunkSize":24,
        "mobile":{"mode":"android-local","statusUrl":"/api/mobile/status"}
      }
    """.trimIndent()
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

  private fun emptyChunkJson(): String = """{"total":0,"startIndex":0,"endIndex":-1,"hasOlder":false,"hasNewer":false,"days":[]}"""

  private fun emptyDayJson(isoDate: String): String {
    return """
      {
        "isoDate":"$isoDate",
        "dateLabel":"$isoDate",
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
    val words = entry.raw.split(Regex("\\s+")).count { it.isNotBlank() }
    val preview = entry.raw.lineSequence().firstOrNull { it.isNotBlank() }.orEmpty().take(180)
    return """
      {
        "isoDate":"${entry.isoDate}",
        "dateLabel":"${entry.isoDate}",
        "monthKey":"${entry.isoDate.take(7)}",
        "monthLabel":"${entry.isoDate.take(7)}",
        "hasTimelineItem":true,
        "hasJournal":${entry.raw.isNotBlank()},
        "wordCount":$words,
        "photoCount":0,
        "photos":[],
        "previewText":"${escapeJson(preview)}",
        "previewLines":["${escapeJson(preview)}"],
        "isPreviewTruncated":${entry.raw.length > preview.length},
        "journal":{"raw":"${escapeJson(entry.raw)}","title":"${escapeJson(entry.title)}","wordCount":$words}
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

  private fun json(value: String, status: Int = 200): LocalResponse {
    return LocalResponse(status, "application/json; charset=utf-8", value.toByteArray(StandardCharsets.UTF_8))
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
