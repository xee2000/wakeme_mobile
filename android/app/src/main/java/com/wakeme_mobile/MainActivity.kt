package com.wakeme_mobile

import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Base64
import android.util.Log
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import java.security.MessageDigest

class MainActivity : ReactActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    // savedInstanceState 를 null 로 전달해 Android Fragment 상태 복원을 차단한다.
    // 앱이 오래 백그라운드에 있다가 돌아올 때 Android가 Fragment 클래스를
    // 이름으로 재생성하려 시도하는데, ProGuard 난독화로 클래스명이 바뀌어
    // Fragment 생성자가 예외를 던지며 크래시가 발생한다.
    // React Native 는 JS 엔진이 자체 상태를 관리하므로 null 을 넘겨도 안전하다.
    super.onCreate(null)
    printKeyHash()
  }

  /** 카카오 개발자 콘솔에 등록할 키 해시를 Logcat에 출력 */
  private fun printKeyHash() {
    try {
      val info = packageManager.getPackageInfo(packageName, PackageManager.GET_SIGNATURES)
      val signatures = info.signatures ?: return
      for (signature in signatures) {
        val md = MessageDigest.getInstance("SHA")
        md.update(signature.toByteArray())
        val keyHash = Base64.encodeToString(md.digest(), Base64.DEFAULT).trim()
        Log.d("KAKAO_KEY_HASH", "▶ 키 해시: $keyHash")
      }
    } catch (e: Exception) {
      Log.e("KAKAO_KEY_HASH", "키 해시 출력 실패", e)
    }
  }

  override fun getMainComponentName(): String = "wakeme_mobile"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
