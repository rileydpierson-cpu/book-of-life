package com.anonymous.bookoflifemobile.local

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.time.Instant

data class MobileEntryRecord(
  val isoDate: String,
  val raw: String,
  val title: String,
  val updatedAt: String,
  val cloudVersion: Long,
  val dirty: Boolean = false
)

data class MobileMediaRecord(
  val id: String,
  val localUri: String?,
  val cloudId: String?,
  val fileName: String,
  val mediaType: String,
  val isoDate: String?,
  val capturedAt: String?,
  val width: Int,
  val height: Int,
  val folder: String?,
  val originalInCloud: Boolean,
  val desktopHostDeviceId: String?,
  val updatedAt: String
)

class MobileLocalStore(context: Context) : SQLiteOpenHelper(
  context.applicationContext,
  "book_of_life_mobile_local.db",
  null,
  2
) {
  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL(
      """
      CREATE TABLE IF NOT EXISTS entries (
        iso_date TEXT PRIMARY KEY NOT NULL,
        raw TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        cloud_version INTEGER NOT NULL DEFAULT 0,
        dirty INTEGER NOT NULL DEFAULT 0
      )
      """.trimIndent()
    )
    db.execSQL(
      """
      CREATE TABLE IF NOT EXISTS media_items (
        id TEXT PRIMARY KEY NOT NULL,
        local_uri TEXT,
        cloud_id TEXT,
        file_name TEXT NOT NULL DEFAULT '',
        media_type TEXT NOT NULL DEFAULT 'image',
        iso_date TEXT,
        captured_at TEXT,
        width INTEGER,
        height INTEGER,
        folder_root_id TEXT,
        folder TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        description TEXT NOT NULL DEFAULT '',
        liked INTEGER NOT NULL DEFAULT 0,
        thumb_cache_path TEXT,
        preview_cache_path TEXT,
        full_cache_path TEXT,
        original_in_cloud INTEGER NOT NULL DEFAULT 0,
        desktop_host_device_id TEXT,
        updated_at TEXT NOT NULL
      )
      """.trimIndent()
    )
    db.execSQL(
      """
      CREATE TABLE IF NOT EXISTS pending_mutations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mutation_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
      """.trimIndent()
    )
    db.execSQL(
      """
      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
      """.trimIndent()
    )
    db.execSQL(
      """
      CREATE TABLE IF NOT EXISTS device_folders (
        id TEXT PRIMARY KEY NOT NULL,
        display_name TEXT NOT NULL,
        tree_uri TEXT NOT NULL,
        cloud_policy TEXT NOT NULL DEFAULT 'derivatives',
        last_scanned_at TEXT
      )
      """.trimIndent()
    )
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    onCreate(db)
  }

  fun getEntry(isoDate: String): MobileEntryRecord? {
    readableDatabase.query(
      "entries",
      arrayOf("iso_date", "raw", "title", "updated_at", "cloud_version", "dirty"),
      "iso_date = ?",
      arrayOf(isoDate),
      null,
      null,
      null,
      "1"
    ).use { cursor ->
      if (!cursor.moveToFirst()) return null
      return MobileEntryRecord(
        isoDate = cursor.getString(0),
        raw = cursor.getString(1),
        title = cursor.getString(2),
        updatedAt = cursor.getString(3),
        cloudVersion = cursor.getLong(4),
        dirty = cursor.getInt(5) != 0
      )
    }
  }

  fun saveEntry(isoDate: String, raw: String): MobileEntryRecord {
    val now = Instant.now().toString()
    val title = raw.lineSequence()
      .map { it.trim().trimStart('#').trim() }
      .firstOrNull { it.isNotBlank() }
      ?.take(120)
      ?: ""
    val currentVersion = getEntry(isoDate)?.cloudVersion ?: 0L
    val values = ContentValues().apply {
      put("iso_date", isoDate)
      put("raw", raw)
      put("title", title)
      put("updated_at", now)
      put("cloud_version", currentVersion)
      put("dirty", 1)
    }
    writableDatabase.insertWithOnConflict("entries", null, values, SQLiteDatabase.CONFLICT_REPLACE)
    enqueueMutation("entry.upsert", isoDate, """{"isoDate":"${escapeJson(isoDate)}"}""")
    return MobileEntryRecord(isoDate, raw, title, now, currentVersion, true)
  }

  fun listEntries(limit: Int = 200): List<MobileEntryRecord> {
    val rows = mutableListOf<MobileEntryRecord>()
    readableDatabase.query(
      "entries",
      arrayOf("iso_date", "raw", "title", "updated_at", "cloud_version", "dirty"),
      null,
      null,
      null,
      null,
      "iso_date DESC",
      limit.coerceAtLeast(1).toString()
    ).use { cursor ->
      while (cursor.moveToNext()) {
        rows.add(
          MobileEntryRecord(
            isoDate = cursor.getString(0),
            raw = cursor.getString(1),
            title = cursor.getString(2),
            updatedAt = cursor.getString(3),
            cloudVersion = cursor.getLong(4),
            dirty = cursor.getInt(5) != 0
          )
        )
      }
    }
    return rows
  }

  fun listDirtyEntries(): List<MobileEntryRecord> = listEntries(10_000).filter { it.dirty }

  fun saveCloudEntry(isoDate: String, raw: String, cloudVersion: Long, updatedAt: String) {
    val title = raw.lineSequence()
      .map { it.trim().trimStart('#').trim() }
      .firstOrNull { it.isNotBlank() }
      ?.take(120)
      ?: ""
    val values = ContentValues().apply {
      put("iso_date", isoDate)
      put("raw", raw)
      put("title", title)
      put("updated_at", updatedAt.ifBlank { Instant.now().toString() })
      put("cloud_version", cloudVersion)
      put("dirty", 0)
    }
    writableDatabase.insertWithOnConflict("entries", null, values, SQLiteDatabase.CONFLICT_REPLACE)
    writableDatabase.delete("pending_mutations", "mutation_type = ? AND entity_id = ?", arrayOf("entry.upsert", isoDate))
  }

  fun markEntryClean(isoDate: String, cloudVersion: Long, updatedAt: String) {
    val values = ContentValues().apply {
      put("cloud_version", cloudVersion)
      put("updated_at", updatedAt.ifBlank { Instant.now().toString() })
      put("dirty", 0)
    }
    writableDatabase.update("entries", values, "iso_date = ?", arrayOf(isoDate))
    writableDatabase.delete("pending_mutations", "mutation_type = ? AND entity_id = ?", arrayOf("entry.upsert", isoDate))
  }

  fun upsertMedia(
    id: String,
    localUri: String?,
    cloudId: String?,
    fileName: String,
    mediaType: String,
    isoDate: String?,
    capturedAt: String?,
    width: Int,
    height: Int,
    folder: String?,
    originalInCloud: Boolean,
    desktopHostDeviceId: String?,
    updatedAt: String
  ) {
    val values = ContentValues().apply {
      put("id", id)
      put("local_uri", localUri)
      put("cloud_id", cloudId)
      put("file_name", fileName)
      put("media_type", mediaType)
      put("iso_date", isoDate)
      put("captured_at", capturedAt)
      put("width", width)
      put("height", height)
      put("folder", folder)
      put("original_in_cloud", if (originalInCloud) 1 else 0)
      put("desktop_host_device_id", desktopHostDeviceId)
      put("updated_at", updatedAt.ifBlank { Instant.now().toString() })
    }
    writableDatabase.insertWithOnConflict("media_items", null, values, SQLiteDatabase.CONFLICT_REPLACE)
  }

  fun mediaCloudId(id: String): String? {
    readableDatabase.query("media_items", arrayOf("cloud_id"), "id = ?", arrayOf(id), null, null, null, "1").use { cursor ->
      return if (cursor.moveToFirst()) cursor.getString(0) else null
    }
  }

  fun getMedia(id: String): MobileMediaRecord? {
    return listMedia("id = ?", arrayOf(id), "1").firstOrNull()
  }

  fun listMedia(limit: Int = 5_000): List<MobileMediaRecord> = listMedia(null, null, limit.toString())

  private fun listMedia(selection: String?, selectionArgs: Array<String>?, limit: String): List<MobileMediaRecord> {
    val rows = mutableListOf<MobileMediaRecord>()
    readableDatabase.query(
      "media_items",
      arrayOf("id", "local_uri", "cloud_id", "file_name", "media_type", "iso_date", "captured_at", "width", "height", "folder", "original_in_cloud", "desktop_host_device_id", "updated_at"),
      selection,
      selectionArgs,
      null,
      null,
      "captured_at DESC",
      limit
    ).use { cursor ->
      while (cursor.moveToNext()) {
        rows.add(MobileMediaRecord(
          id = cursor.getString(0),
          localUri = cursor.getString(1),
          cloudId = cursor.getString(2),
          fileName = cursor.getString(3),
          mediaType = cursor.getString(4),
          isoDate = cursor.getString(5),
          capturedAt = cursor.getString(6),
          width = cursor.getInt(7),
          height = cursor.getInt(8),
          folder = cursor.getString(9),
          originalInCloud = cursor.getInt(10) != 0,
          desktopHostDeviceId = cursor.getString(11),
          updatedAt = cursor.getString(12)
        ))
      }
    }
    return rows
  }

  fun countEntries(): Int = count("entries")

  fun countMedia(): Int = count("media_items")

  fun countFolders(): Int = count("device_folders")

  fun countPendingMutations(): Int {
    readableDatabase.rawQuery(
      "SELECT COUNT(*) FROM pending_mutations WHERE state IN ('queued', 'retry')",
      emptyArray()
    ).use { cursor ->
      return if (cursor.moveToFirst()) cursor.getInt(0) else 0
    }
  }

  fun lastSyncAt(): String? = getState("last_sync_at")

  fun lastMediaScanAt(): String? = getState("last_media_scan_at")

  fun setState(key: String, value: String) {
    val now = Instant.now().toString()
    val values = ContentValues().apply {
      put("key", key)
      put("value", value)
      put("updated_at", now)
    }
    writableDatabase.insertWithOnConflict("sync_state", null, values, SQLiteDatabase.CONFLICT_REPLACE)
  }

  fun removeState(key: String) {
    writableDatabase.delete("sync_state", "key = ?", arrayOf(key))
  }

  private fun enqueueMutation(type: String, entityId: String, payloadJson: String) {
    val now = Instant.now().toString()
    val values = ContentValues().apply {
      put("mutation_type", type)
      put("entity_id", entityId)
      put("payload_json", payloadJson)
      put("state", "queued")
      put("attempts", 0)
      put("created_at", now)
      put("updated_at", now)
    }
    writableDatabase.insert("pending_mutations", null, values)
  }

  fun getState(key: String): String? {
    readableDatabase.query(
      "sync_state",
      arrayOf("value"),
      "key = ?",
      arrayOf(key),
      null,
      null,
      null,
      "1"
    ).use { cursor ->
      return if (cursor.moveToFirst()) cursor.getString(0) else null
    }
  }

  private fun count(table: String): Int {
    readableDatabase.rawQuery("SELECT COUNT(*) FROM $table", emptyArray()).use { cursor ->
      return if (cursor.moveToFirst()) cursor.getInt(0) else 0
    }
  }
}

fun escapeJson(value: String): String {
  val builder = StringBuilder(value.length + 16)
  for (char in value) {
    when (char) {
      '\\' -> builder.append("\\\\")
      '"' -> builder.append("\\\"")
      '\n' -> builder.append("\\n")
      '\r' -> builder.append("\\r")
      '\t' -> builder.append("\\t")
      else -> {
        if (char.code < 0x20) {
          builder.append("\\u")
          builder.append(char.code.toString(16).padStart(4, '0'))
        } else {
          builder.append(char)
        }
      }
    }
  }
  return builder.toString()
}
