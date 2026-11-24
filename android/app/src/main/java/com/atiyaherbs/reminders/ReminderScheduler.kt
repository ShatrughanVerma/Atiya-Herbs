package com.atiyaherbs.reminders

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import java.util.Calendar
import org.json.JSONArray
import org.json.JSONObject

/** One reminder that rings every day at [hour]:[minute] (the phone's own clock). */
data class Reminder(
    val id: Int,
    val hour: Int,
    val minute: Int,
    val title: String,
    val body: String,
)

/**
 * Health Wellness reminders (water, medicines, evening check-in) as daily alarms.
 *  - The list of reminders is kept in the app's own storage, so the alarms can be set again after the phone restarts.
 *  - Each alarm rings once; when it rings, the next one for the next day is set (see [ReminderReceiver]).
 *  - On Android 12 and later exact alarms need the person's "Alarms & reminders" permission. Without it the alarms still
 *    ring, but Android may delay them by a few minutes.
 */
object ReminderScheduler {
  const val CHANNEL_ID = "wellness_reminders"
  private const val PREFS = "atiya_wellness_reminders"
  private const val KEY = "list"
  private const val ONE_MINUTE = 60_000L

  fun save(context: Context, list: List<Reminder>) {
    val array = JSONArray()
    list.forEach {
      array.put(
          JSONObject()
              .put("id", it.id)
              .put("hour", it.hour)
              .put("minute", it.minute)
              .put("title", it.title)
              .put("body", it.body))
    }
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, array.toString()).apply()
  }

  fun load(context: Context): List<Reminder> {
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return emptyList()
    return try {
      val array = JSONArray(raw)
      (0 until array.length()).map {
        val o = array.getJSONObject(it)
        Reminder(o.getInt("id"), o.getInt("hour"), o.getInt("minute"), o.getString("title"), o.getString("body"))
      }
    } catch (e: Exception) {
      emptyList()
    }
  }

  private fun pendingIntent(context: Context, id: Int): PendingIntent {
    val intent = Intent(context, ReminderReceiver::class.java).putExtra("id", id)
    return PendingIntent.getBroadcast(
        context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  fun canScheduleExact(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    return (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).canScheduleExactAlarms()
  }

  /** The next time the clock shows hour:minute after [from] (today, or tomorrow when it has passed). */
  fun nextTimeMillis(hour: Int, minute: Int, from: Long = System.currentTimeMillis()): Long {
    val calendar =
        Calendar.getInstance().apply {
          timeInMillis = from
          set(Calendar.HOUR_OF_DAY, hour)
          set(Calendar.MINUTE, minute)
          set(Calendar.SECOND, 0)
          set(Calendar.MILLISECOND, 0)
        }
    if (calendar.timeInMillis <= from) calendar.add(Calendar.DAY_OF_YEAR, 1)
    return calendar.timeInMillis
  }

  /**
   * Sets the next alarm of a reminder. [justRang] = true when this is called from the alarm that just rang: the next
   * one is then looked for after the next minute, so it is always tomorrow's.
   */
  fun scheduleNext(context: Context, reminder: Reminder, justRang: Boolean = false) {
    val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val from = System.currentTimeMillis() + if (justRang) ONE_MINUTE else 0L
    val at = nextTimeMillis(reminder.hour, reminder.minute, from)
    val pending = pendingIntent(context, reminder.id)
    try {
      if (canScheduleExact(context)) {
        alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
      } else {
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
      }
    } catch (e: SecurityException) {
      alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
    }
  }

  fun cancelAll(context: Context) {
    val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    load(context).forEach { alarms.cancel(pendingIntent(context, it.id)) }
  }

  /** Throws away the old reminders and sets exactly these. */
  fun replaceAll(context: Context, list: List<Reminder>) {
    cancelAll(context)
    save(context, list)
    list.forEach { scheduleNext(context, it) }
  }

  /** After a restart of the phone (or an update of the app) the alarms are gone: set them again. */
  fun rescheduleAll(context: Context) {
    load(context).forEach { scheduleNext(context, it) }
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel =
        NotificationChannel(CHANNEL_ID, "Health Wellness reminders", NotificationManager.IMPORTANCE_DEFAULT)
            .apply { description = "Water, medicine and evening check-in reminders" }
    manager.createNotificationChannel(channel)
  }

  fun show(context: Context, id: Int, title: String, body: String) {
    ensureChannel(context)
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val open =
        launch?.let {
          PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
    val notification =
        NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(context.applicationInfo.icon)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .apply { if (open != null) setContentIntent(open) }
            .build()
    try {
      (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(id, notification)
    } catch (e: SecurityException) {
      // notifications are not allowed (Android 13 and later): nothing to show
    }
  }
}
