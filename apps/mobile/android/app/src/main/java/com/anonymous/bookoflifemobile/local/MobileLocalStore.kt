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
  val cloudVersion: Long
)

class MobileLocalStore(context: Context) : SQLiteOpenHelper(
  context.applicationContext,
  "book_of_life_mobile_local.db",
  null,
  1
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
      arrayOf("iso_date", "raw", "title", "updated_at", "cloud_version"),
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
        cloudVersion = cursor.getLong(4)
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
    return MobileEntryRecord(isoDate, raw, title, now, currentVersion)
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

  private fun getState(key: String): String? {
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
