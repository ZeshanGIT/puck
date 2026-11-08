package puck.fullscreen

import android.app.NotificationManager
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
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.sign

/**
 * The compact alert card, drawn over other apps. It needs the overlay permission the person grants
 * on Android's "Display over other apps" page; without it nothing is drawn and the notification
 * carries the alert alone. One card at a time. It never takes focus, and touches outside it reach
 * the app underneath. A tap opens Puck on that alert. A swipe sideways or Dismiss removes the card
 * and stops its ring; Snooze does the same and opens Puck on the snooze choices for that alert.
 */
internal object OverlayCard {
  const val EXTRA_QUESTION_ID = "puck.overlayQuestionId"
  const val EXTRA_SNOOZE = "puck.overlaySnooze"
  const val ACTION_DISMISS = "dismiss"
  const val ACTION_SNOOZE = "snooze"

  private const val SWIPE_FRACTION = 0.3f
  private const val SETTLE_MS = 150L

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

  data class Opened(val questionId: String, val snooze: Boolean)

  /** Set by the module: reports a dismiss or snooze to JavaScript while the app is running. */
  @Volatile var onAction: ((questionId: String, action: String) -> Unit)? = null

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

  /** The alert a tap on the card opened (a cold start) and whether Snooze was chosen; taken once. */
  fun takeOpened(activityIntent: Intent?): Opened? {
    val id = activityIntent?.getStringExtra(EXTRA_QUESTION_ID) ?: return null
    val snooze = activityIntent.getBooleanExtra(EXTRA_SNOOZE, false)
    activityIntent.removeExtra(EXTRA_QUESTION_ID)
    activityIntent.removeExtra(EXTRA_SNOOZE)
    return Opened(id, snooze)
  }

  /**
   * Cancels the ring notifications for one alert. Notifee posts them with the alert id as the tag,
   * so the id and tag are matched from the active notifications rather than rebuilt.
   */
  fun silenceNotifications(context: Context, questionId: String) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.activeNotifications
      .filter { it.tag == questionId }
      .forEach { manager.cancel(it.tag, it.id) }
  }

  fun openApp(context: Context, questionId: String, snooze: Boolean) {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    launch.putExtra(EXTRA_QUESTION_ID, questionId)
    launch.putExtra(EXTRA_SNOOZE, snooze)
    context.startActivity(launch)
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

  /** Removes the card, stops this alert's ring, and reports the action to JavaScript. */
  private fun release(context: Context, questionId: String, action: String) {
    removeView()
    silenceNotifications(context, questionId)
    onAction?.invoke(questionId, action)
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
      setOnClickListener { openApp(context, card.questionId, snooze = false); removeView() }
    }
    box.addView(line(context, card.label, card.accent, 12f, bold = true))
    box.addView(line(context, card.title, card.ink, 16f, bold = true, maxLines = 1))
    box.addView(line(context, card.body, card.ink2, 14f, maxLines = 2))
    box.addView(line(context, "Tap to open, swipe to dismiss", card.ink2, 12f, topPaddingDp = 6))
    box.addView(actionRow(context, card))
    swipeToDismiss(context, box, card.questionId)
    return FrameLayout(context).apply {
      setPadding(dp(context, 12), 0, dp(context, 12), 0)
      addView(box, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))
    }
  }

  private fun actionRow(context: Context, card: Spec): View = LinearLayout(context).apply {
    orientation = LinearLayout.HORIZONTAL
    gravity = Gravity.END
    setPadding(0, dp(context, 6), 0, 0)
    addView(action(context, "Dismiss", card.ink2) { release(context, card.questionId, ACTION_DISMISS) })
    addView(action(context, "Snooze", card.accent) {
      release(context, card.questionId, ACTION_SNOOZE)
      openApp(context, card.questionId, snooze = true)
    })
  }

  private fun action(context: Context, label: String, colour: Int, onClick: () -> Unit): TextView =
    TextView(context).apply {
      text = label
      setTextColor(colour)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
      typeface = Typeface.DEFAULT_BOLD
      setPadding(dp(context, 12), dp(context, 8), dp(context, 12), dp(context, 8))
      isClickable = true
      isFocusable = true
      val outValue = TypedValue()
      context.theme.resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, outValue, true)
      setBackgroundResource(outValue.resourceId)
      setOnClickListener { onClick() }
    }

  /** A horizontal drag moves the card with the finger; past 30% of its width it is dismissed. */
  private fun swipeToDismiss(context: Context, box: View, questionId: String) {
    val slop = ViewConfiguration.get(context).scaledTouchSlop
    var downX = 0f
    var dragging = false
    box.setOnTouchListener { view, event ->
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downX = event.rawX
          dragging = false
          true
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = event.rawX - downX
          if (!dragging && abs(dx) > slop) dragging = true
          if (dragging) {
            view.translationX = dx
            view.alpha = 1f - min(abs(dx) / view.width, 0.7f)
          }
          true
        }
        MotionEvent.ACTION_UP -> {
          val dx = event.rawX - downX
          when {
            !dragging -> view.performClick()
            abs(dx) > view.width * SWIPE_FRACTION -> {
              view.animate()
                .translationX(sign(dx) * view.width)
                .alpha(0f)
                .setDuration(SETTLE_MS)
                .withEndAction { release(context, questionId, ACTION_DISMISS) }
                .start()
            }
            else -> settleBack(view)
          }
          dragging = false
          true
        }
        MotionEvent.ACTION_CANCEL -> {
          if (dragging) settleBack(view)
          dragging = false
          true
        }
        else -> false
      }
    }
  }

  private fun settleBack(view: View) {
    view.animate().translationX(0f).alpha(1f).setDuration(SETTLE_MS).start()
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
