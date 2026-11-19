# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# Libraries that load classes by name: keep them intact when the release build is shrunk
-keep class io.agora.** { *; }
-dontwarn io.agora.**
-keep class org.webrtc.** { *; }
-keep class livekit.** { *; }
-keep class io.livekit.** { *; }
-keep class com.oney.WebRTCModule.** { *; }
-keep class com.oblador.keychain.** { *; }
-dontwarn org.webrtc.**
-dontwarn livekit.org.jni_zero.JniZeroJni
