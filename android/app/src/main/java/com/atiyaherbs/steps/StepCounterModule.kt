package com.atiyaherbs.steps

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Live steps from the phone's own step counter sensor (TYPE_STEP_COUNTER).
 * The sensor counts all day in hardware, even while the app is closed; its number is the total since the phone was last
 * restarted. While the app is open this module sends every new number to JavaScript as "StepCounterUpdate" {steps}.
 * Listening stops when the app goes to the background (saves battery) and starts again when it comes back; the sensor's
 * total keeps counting meanwhile, so no steps are lost.
 * Needs the ACTIVITY_RECOGNITION permission on Android 10 and later (asked from JavaScript).
 */
class StepCounterModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), SensorEventListener, LifecycleEventListener {

  private val sensorManager = reactContext.getSystemService(Context.SENSOR_SERVICE) as SensorManager
  private val stepSensor: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
  private var wanted = false // JavaScript asked for updates
  private var listening = false // the sensor is registered right now

  init {
    reactContext.addLifecycleEventListener(this)
  }

  override fun getName() = "StepCounter"

  @ReactMethod
  fun isSupported(promise: Promise) {
    promise.resolve(stepSensor != null)
  }

  /** Starts the live updates. Resolves true when the sensor is listening, false when this phone has no step counter. */
  @ReactMethod
  fun start(promise: Promise) {
    wanted = true
    register()
    promise.resolve(stepSensor != null && listening)
  }

  @ReactMethod
  fun stop(promise: Promise) {
    wanted = false
    unregister()
    promise.resolve(null)
  }

  // Needed by NativeEventEmitter
  @ReactMethod fun addListener(eventName: String) {}

  @ReactMethod fun removeListeners(count: Int) {}

  override fun onSensorChanged(event: SensorEvent) {
    val context = reactApplicationContext
    if (!context.hasActiveReactInstance() || event.values.isEmpty()) return
    val params = Arguments.createMap().apply { putDouble("steps", event.values[0].toDouble()) }
    context
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("StepCounterUpdate", params)
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

  private fun register() {
    val sensor = stepSensor ?: return
    if (listening) return
    // The first value arrives at once (the counter reports its current total when a listener is added)
    listening = sensorManager.registerListener(this, sensor, SensorManager.SENSOR_DELAY_UI)
  }

  private fun unregister() {
    if (!listening) return
    sensorManager.unregisterListener(this)
    listening = false
  }

  override fun onHostResume() {
    if (wanted) register()
  }

  override fun onHostPause() {
    unregister()
  }

  override fun onHostDestroy() {
    unregister()
  }
}
