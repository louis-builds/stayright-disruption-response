package expo.modules.callrec

import android.os.Build
import android.os.Environment
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class CallRecModule : Module() {
  private fun storageRoots(): List<File> {
    val roots = linkedSetOf<File>()
    Environment.getExternalStorageDirectory()?.let { roots.add(it) }
    roots.add(File("/storage/emulated/0"))
    roots.add(File("/sdcard"))
    return roots.toList()
  }

  private fun callRecDirs(): List<File> {
    val relative = listOf(
      "MIUI/sound_recorder/call_rec",
      "MIUI/sound_recorder",
      "Recordings/Call Recordings",
      "Sounds/Call Recordings",
    )
    return storageRoots().flatMap { root -> relative.map { File(root, it) } }
  }

  private fun collectFiles(dir: File, depth: Int, out: ArrayList<Map<String, Any>>, seen: HashSet<String>) {
    if (depth > 2) return
    val children = try {
      dir.listFiles()
    } catch (_: SecurityException) {
      null
    } ?: return
    for (file in children) {
      if (file.isDirectory) {
        collectFiles(file, depth + 1, out, seen)
        continue
      }
      if (!file.isFile || file.length() < 200L) continue
      val name = file.name.lowercase()
      if (name == ".nomedia" || name.endsWith(".jpg") || name.endsWith(".png") || name.endsWith(".xml")) continue
      if (!seen.add(file.absolutePath)) continue
      out.add(
        mapOf(
          "path" to file.absolutePath,
          "uri" to "file://${file.absolutePath}",
          "name" to file.name,
          "time" to file.lastModified().toDouble(),
          "size" to file.length().toDouble(),
        ),
      )
    }
  }

  override fun definition() = ModuleDefinition {
    Name("CallRec")

    Function("hasAllFilesAccess") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) true
      else Environment.isExternalStorageManager() || callRecDirs().any { it.canRead() }
    }

    Function("scanStatus") {
      buildString {
        append("manager=").append(
          if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) true
          else Environment.isExternalStorageManager(),
        )
        val seen = HashSet<String>()
        for (dir in callRecDirs()) {
          if (!seen.add(dir.absolutePath)) continue
          append(" | ").append(dir.absolutePath)
          append(" exists=").append(dir.exists())
          append(" read=").append(dir.canRead())
          append(" listed=").append(dir.listFiles()?.size ?: -1)
        }
      }
    }

    AsyncFunction("listXiaomiCallRec") {
      val out = ArrayList<Map<String, Any>>()
      val seen = HashSet<String>()
      val visited = HashSet<String>()
      for (dir in callRecDirs()) {
        if (!dir.isDirectory) continue
        if (!visited.add(dir.absolutePath)) continue
        collectFiles(dir, 0, out, seen)
      }
      out
    }

    AsyncFunction("copyToCache") { path: String ->
      val src = File(path.removePrefix("file://"))
      if (!src.isFile) throw IllegalStateException("Missing recording ${src.absolutePath}")
      val ctx = appContext.reactContext
        ?: appContext.currentActivity?.applicationContext
        ?: throw IllegalStateException("No Android context")
      val ext = src.extension.ifBlank { "mp3" }
      val dest = File(ctx.cacheDir, "call-latest.$ext")
      src.inputStream().use { input ->
        dest.outputStream().use { output -> input.copyTo(output) }
      }
      "file://${dest.absolutePath}"
    }
  }
}
