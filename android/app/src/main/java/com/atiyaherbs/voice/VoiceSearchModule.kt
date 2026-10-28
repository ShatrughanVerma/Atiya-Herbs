package com.atiyaherbs.voice

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.speech.RecognizerIntent
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Opens the system speech-recognition popup (Google voice typing) and returns what the user said.
 * The recognizer app records the audio, so this app does not need the RECORD_AUDIO permission.
 */
class VoiceSearchModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

  private var pending: Promise? = null

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName() = "VoiceSearch"

  @ReactMethod
  fun listen(prompt: String, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("no_activity", "The app is not in the foreground.")
      return
    }
    pending?.reject("interrupted", "A new voice search was started.")
    pending = promise

    val intent =
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
          putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
          putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN")
          putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
          putExtra(RecognizerIntent.EXTRA_PROMPT, prompt)
        }
    try {
      activity.startActivityForResult(intent, REQUEST_CODE)
    } catch (e: ActivityNotFoundException) {
      pending = null
      promise.reject("not_available", "Voice search is not available on this phone.")
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != REQUEST_CODE) return
    val promise = pending ?: return
    pending = null

    val results = Arguments.createArray()
    if (resultCode == Activity.RESULT_OK) {
      data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.forEach { results.pushString(it) }
    }
    // An empty list means the user cancelled or nothing was heard.
    promise.resolve(results)
  }

  override fun onNewIntent(intent: Intent) {}

  companion object {
    private const val REQUEST_CODE = 4711
  }
}
