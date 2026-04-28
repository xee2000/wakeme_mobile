# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# ── 제네릭 타입 정보 보존 ──────────────────────────────────────────
# Retrofit이 런타임에 Call<Foo> 등의 타입 파라미터를 리플렉션으로 읽어야 함.
# 없으면 "Call return type must be parameterized" 크래시 발생.
-keepattributes Signature
-keepattributes *Annotation*
-keepattributes Exceptions
-keepattributes InnerClasses
-keepattributes EnclosingMethod

# ── Kakao SDK ─────────────────────────────────────────────────────
# 카카오 SDK는 내부적으로 Retrofit을 사용. 클래스/인터페이스 모두 보존.
-keep class com.kakao.sdk.** { *; }
-keep interface com.kakao.sdk.** { *; }
-dontwarn com.kakao.sdk.**

# ── Retrofit 2 ────────────────────────────────────────────────────
-keep,allowobfuscation,allowshrinking interface retrofit2.Call
-keep,allowobfuscation,allowshrinking class retrofit2.Response
# Kotlin suspend 함수 → Retrofit이 Continuation 타입을 리플렉션으로 확인
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation

# ── OkHttp ────────────────────────────────────────────────────────
-dontwarn okhttp3.**
-dontwarn okio.**
