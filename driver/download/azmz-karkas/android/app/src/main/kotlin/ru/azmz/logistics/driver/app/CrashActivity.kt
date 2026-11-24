package ru.azmz.logistics.driver.app

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/**
 * Экран ошибки без Compose и без MapLibre: рисуется системными View,
 * поэтому открывается даже если упал UI-стек.
 */
class CrashActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val trace = intent.getStringExtra(EXTRA_TRACE)
            ?: getSharedPreferences("azmz_crash", Context.MODE_PRIVATE)
                .getString("last_crash", null)
            ?: "Текст ошибки не сохранился. Перезапустите приложение."

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#101E2E"))
            setPadding(32, 48, 32, 32)
        }

        root.addView(TextView(this).apply {
            text = "Приложение остановилось"
            setTextColor(Color.WHITE)
            textSize = 22f
            setTypeface(typeface, Typeface.BOLD)
        })

        root.addView(TextView(this).apply {
            text = "Покажите этот текст разработчику — по нему видно причину. " +
                "Данные в очереди не потеряны."
            setTextColor(Color.parseColor("#B8C4D4"))
            textSize = 14f
            setPadding(0, 16, 0, 16)
        })

        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f,
            )
            setBackgroundColor(Color.parseColor("#0B1622"))
        }
        val traceView = TextView(this).apply {
            text = trace
            setTextColor(Color.parseColor("#E6EDF5"))
            textSize = 11f
            typeface = Typeface.MONOSPACE
            setTextIsSelectable(true)
            setPadding(20, 20, 20, 20)
        }
        scroll.addView(traceView)
        root.addView(scroll)

        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.END
            setPadding(0, 20, 0, 0)
        }
        row.addView(Button(this).apply {
            text = "Копировать"
            setOnClickListener {
                val clipboard = getSystemService(ClipboardManager::class.java)
                clipboard.setPrimaryClip(ClipData.newPlainText("АЭМЗ Поток", trace))
                Toast.makeText(this@CrashActivity, "Текст скопирован", Toast.LENGTH_SHORT).show()
            }
        })
        row.addView(Button(this).apply {
            text = "Закрыть"
            setOnClickListener { finish() }
        })
        root.addView(row)

        setContentView(root)
    }

    companion object {
        const val EXTRA_TRACE = "trace"
    }
}
