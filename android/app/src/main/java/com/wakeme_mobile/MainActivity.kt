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
    super.onCreate(savedInstanceState)
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
