package com.atiyaherbs

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.atiyaherbs.voice.VoiceSearchPackage
import com.atiyaherbs.calls.CallsPackage
import com.livekit.reactnative.LiveKitReactNative
import com.livekit.reactnative.audio.AudioType

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(VoiceSearchPackage())
          add(CallsPackage())
        },
    )
  }

  override fun onCreate() {
    // LiveKit voice and video calls: must come before any other React Native initialization
    LiveKitReactNative.setup(this, AudioType.CommunicationAudioType())
    super.onCreate()
    loadReactNative(this)
  }
}
