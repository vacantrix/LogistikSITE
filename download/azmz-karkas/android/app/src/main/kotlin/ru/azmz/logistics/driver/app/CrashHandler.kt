package ru.azmz.logistics.driver.app

import android.content.Context
import android.content.Intent
import android.os.Process
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter

/**
 * Аварийный экран для пилота: вместо молчаливого закрытия приложение
 * показывает текст ошибки. Файл с трейсом остаётся в приватной папке
 * приложения, поэтому по нему можно починить причину даже без logcat.
 */
object CrashHandler {
    private const val PREFS = "azmz_crash"
    private const val KEY_LAST = "last_crash"

    fun install(context: Context) {
        val app = context.applicationContext

        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            val trace = buildString {
                appendLine("АЭМЗ Поток · Водитель")
                appendLine("Поток: ${thread.name}")
                appendLine()
                val buffer = StringWriter()
                error.printStackTrace(PrintWriter(buffer))
                append(buffer.toString())
            }

            runCatching {
                app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putString(KEY_LAST, trace)
                    .commit()
            }
            runCatching {
                val dir = app.getExternalFilesDir(null) ?: app.filesDir
                File(dir, "last-crash.txt").writeText(trace)
            }

            // Показываем экран до того, как система убьёт процесс.
            runCatching {
                app.startActivity(
                    Intent(app, CrashActivity::class.java)
                        .putExtra(CrashActivity.EXTRA_TRACE, trace)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK),
                )
            }
            runCatching { Thread.sleep(1500) }

            // Свой экран уже показан — системный диалог не нужен.
            Process.killProcess(Process.myPid())
            kotlin.system.exitProcess(10)
        }
    }
}
