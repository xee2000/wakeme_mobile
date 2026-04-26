package com.wakeme_mobile

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.kakao.sdk.common.KakaoSdk
import com.naver.maps.map.NaverMapSdk

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(WakeMeServicePackage())   // ✅ 이게 핵심
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // 카카오 SDK 초기화 (네이티브 앱 키)
    KakaoSdk.init(this, "b1a33e107f188d1a51e5302ead784509")
    NaverMapSdk.getInstance(this).client = NaverMapSdk.NcpKeyClient("hudu5weji7")
    loadReactNative(this)
  }
}
