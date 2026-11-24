package com.atiyaherbs.reminders

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Alarms are forgotten when the phone restarts or the app is updated: set them again. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_MY_PACKAGE_REPLACED -> ReminderScheduler.rescheduleAll(context)
    }
  }
}
