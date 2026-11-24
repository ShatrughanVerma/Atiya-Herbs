package com.atiyaherbs.reminders

import android.app.TimePickerDialog
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.UiThreadUtil

/**
 * The reminders of Health Wellness, for JavaScript (src/wellness/native/reminders.js). The alarms themselves are in
 * [ReminderScheduler]. Asking for the notification permission (Android 13+) is done from JavaScript.
 */
class RemindersModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "Reminders"

  /** Replaces every reminder with this list of {id, hour, minute, title, body}. Resolves how many were set. */
  @ReactMethod
  fun replaceAll(items: ReadableArray, promise: Promise) {
    try {
      val list =
          (0 until items.size()).map {
            val item = items.getMap(it)!!
            Reminder(
                item.getInt("id"),
                item.getInt("hour"),
                item.getInt("minute"),
                item.getString("title") ?: "",
                item.getString("body") ?: "")
          }
      ReminderScheduler.replaceAll(reactApplicationContext, list)
      promise.resolve(list.size)
    } catch (e: Exception) {
      promise.reject("reminders_failed", "The reminders could not be set.", e)
    }
  }

  @ReactMethod
  fun cancelAll(promise: Promise) {
    ReminderScheduler.cancelAll(reactApplicationContext)
    ReminderScheduler.save(reactApplicationContext, emptyList())
    promise.resolve(null)
  }

  /** Shows a notification right now, to try them out. */
  @ReactMethod
  fun sendTest(title: String, body: String, promise: Promise) {
    ReminderScheduler.show(reactApplicationContext, TEST_ID, title, body)
    promise.resolve(null)
  }

  @ReactMethod
  fun notificationsEnabled(promise: Promise) {
    promise.resolve(NotificationManagerCompat.from(reactApplicationContext).areNotificationsEnabled())
  }

  /** false on Android 12 and later until the person allows "Alarms & reminders": the alarms may then come late. */
  @ReactMethod
  fun canScheduleExact(promise: Promise) {
    promise.resolve(ReminderScheduler.canScheduleExact(reactApplicationContext))
  }

  @ReactMethod
  fun openExactAlarmSettings(promise: Promise) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val intent =
          Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${reactApplicationContext.packageName}"))
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        reactApplicationContext.startActivity(intent)
      } catch (e: Exception) {
        // this phone has no such screen
      }
    }
    promise.resolve(null)
  }

  @ReactMethod
  fun openNotificationSettings(promise: Promise) {
    val intent =
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, reactApplicationContext.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      reactApplicationContext.startActivity(intent)
    } catch (e: Exception) {
      // this phone has no such screen
    }
    promise.resolve(null)
  }

  /** Opens the system time picker. Resolves {hour, minute}, or null when the person cancels. */
  @ReactMethod
  fun pickTime(hour: Int, minute: Int, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("no_activity", "The app is not in the foreground.")
      return
    }
    UiThreadUtil.runOnUiThread {
      var answered = false
      val dialog =
          TimePickerDialog(
              activity,
              { _, pickedHour, pickedMinute ->
                if (!answered) {
                  answered = true
                  val result = Arguments.createMap()
                  result.putInt("hour", pickedHour)
                  result.putInt("minute", pickedMinute)
                  promise.resolve(result)
                }
              },
              hour,
              minute,
              false)
      dialog.setOnCancelListener {
        if (!answered) {
          answered = true
          promise.resolve(null)
        }
      }
      dialog.show()
    }
  }

  companion object {
    private const val TEST_ID = 999_999
  }
}
