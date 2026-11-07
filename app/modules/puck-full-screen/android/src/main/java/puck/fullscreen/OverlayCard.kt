package puck.fullscreen

import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The compact alert card, drawn over other apps. It needs the overlay permission the person grants
 * on Android's "Display over other apps" page; without it nothing is drawn and the notification
 * carries the alert alone. One card at a time. It never takes focus, and touches outside it reach
 * the app underneath. A tap on the card opens Puck on that alert and the card goes away.
 */
internal object OverlayCard {
  const val EXTRA_QUESTION_ID = "puck.overlayQuestionId"

  data class Spec(
    val questionId: String,
    val label: String,
    val title: String,
    val body: String,
    val background: Int,
    val ink: Int,
    val ink2: Int,
    val accent: Int,
  )

  private val main = Handler(Looper.getMainLooper())
  private var view: View? = null
  private var shownId: String? = null

  fun canDraw(context: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)

  fun show(context: Context, card: Spec): Boolean {
    if (!canDraw(context)) return false
    val app = context.applicationContext
    main.post {
      removeView()
      val root = buildView(app, card)
      val type =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
          @Suppress("DEPRECATION")
          WindowManager.LayoutParams.TYPE_PHONE
        }
      val params = WindowManager.LayoutParams(
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        type,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
          WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
          WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT,
      ).apply {
        gravity = Gravity.TOP
        y = dp(app, 44)
      }
      try {
        (app.getSystemService(Context.WINDOW_SERVICE) as WindowManager).addView(root, params)
        view = root
        shownId = card.questionId
      } catch (error: RuntimeException) {
        // The permission was taken back, or the window manager refused the view: no card.
        view = null
        shownId = null
      }
    }
    return true
  }

  /** Removes the card when it shows `questionId`, or any card when `questionId` is null. */
  fun hide(questionId: String?) {
    main.post {
      if (questionId == null || questionId == shownId) removeView()
    }
  }

  /** The alert a tap on the card opened (a cold start), taken once so it does not open again. */
  fun takeOpenedQuestionId(activityIntent: Intent?): String? {
    val id = activityIntent?.getStringExtra(EXTRA_QUESTION_ID) ?: return null
    activityIntent.removeExtra(EXTRA_QUESTION_ID)
    return id
  }

  private fun removeView() {
    val current = view ?: return
    view = null
    shownId = null
    try {
      (current.context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).removeView(current)
    } catch (error: RuntimeException) {
      // Already gone.
    }
  }

  private fun open(context: Context, questionId: String) {
    removeView()
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    launch.putExtra(EXTRA_QUESTION_ID, questionId)
    context.startActivity(launch)
  }

  private fun buildView(context: Context, card: Spec): View {
    val box = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(context, 16), dp(context, 14), dp(context, 16), dp(context, 14))
      background = GradientDrawable().apply {
        setColor(card.background)
        cornerRadius = dp(context, 18).toFloat()
      }
      elevation = dp(context, 10).toFloat()
      setOnClickListener { open(context, card.questionId) }
    }
    box.addView(line(context, card.label, card.accent, 12f, bold = true))
    box.addView(line(context, card.title, card.ink, 16f, bold = true, maxLines = 1))
    box.addView(line(context, card.body, card.ink2, 14f, maxLines = 2))
    box.addView(line(context, "Tap to open", card.ink2, 12f, topPaddingDp = 6))
    return FrameLayout(context).apply {
      setPadding(dp(context, 12), 0, dp(context, 12), 0)
      addView(box, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))
    }
  }

  private fun line(
    context: Context,
    text: String,
    colour: Int,
    sizeSp: Float,
    bold: Boolean = false,
    maxLines: Int = 1,
    topPaddingDp: Int = 0,
  ): TextView = TextView(context).apply {
    this.text = text
    setTextColor(colour)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
    if (bold) typeface = Typeface.DEFAULT_BOLD
    this.maxLines = maxLines
    ellipsize = android.text.TextUtils.TruncateAt.END
    setPadding(0, dp(context, topPaddingDp), 0, 0)
  }

  private fun dp(context: Context, value: Int): Int =
    (value * context.resources.displayMetrics.density).toInt()
}
