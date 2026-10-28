package com.atiyaherbs.calls

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.provider.ContactsContract
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Opens the system contact picker for phone numbers and returns the one the user chose.
 * Android grants access to just that contact, so READ_CONTACTS is not needed.
 */
class ContactPickerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

  private var pending: Promise? = null

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName() = "ContactPicker"

  @ReactMethod
  fun pickPhoneNumber(promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("no_activity", "The app is not in the foreground.")
      return
    }
    pending?.resolve(null)
    pending = promise
    try {
      activity.startActivityForResult(
          Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI), REQUEST_CODE)
    } catch (e: ActivityNotFoundException) {
      pending = null
      promise.reject("not_available", "No contacts app found on this phone.")
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != REQUEST_CODE) return
    val promise = pending ?: return
    pending = null

    val uri = data?.data
    if (resultCode != Activity.RESULT_OK || uri == null) {
      promise.resolve(null)
      return
    }
    try {
      val columns =
          arrayOf(
              ContactsContract.CommonDataKinds.Phone.NUMBER,
              ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
      reactApplicationContext.contentResolver.query(uri, columns, null, null, null).use { cursor ->
        if (cursor != null && cursor.moveToFirst()) {
          promise.resolve(
              Arguments.createMap().apply {
                putString("number", cursor.getString(0))
                putString("name", cursor.getString(1))
              })
        } else {
          promise.resolve(null)
        }
      }
    } catch (e: Exception) {
      promise.reject("read_failed", "Could not read the chosen contact.", e)
    }
  }

  override fun onNewIntent(intent: Intent) {}

  companion object {
    private const val REQUEST_CODE = 4102
  }
}
