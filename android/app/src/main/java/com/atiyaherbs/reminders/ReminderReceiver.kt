package com.atiyaherbs.reminders

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Rings when a reminder's alarm goes off: shows the notification and sets the same reminder for tomorrow. */
class ReminderReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getIntExtra("id", -1)
    val reminder = ReminderScheduler.load(context).firstOrNull { it.id == id } ?: return
    ReminderScheduler.show(context, reminder.id, reminder.title, reminder.body)
    ReminderScheduler.scheduleNext(context, reminder, justRang = true)
  }
}
