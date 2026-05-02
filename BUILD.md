# WakeMe Android 릴리즈 APK 빌드 가이드

---

## 1. 릴리즈 키스토어 생성 (최초 1회)

```bash
keytool -genkeypair -v \
  -keystore android/app/release/wakeme-release.keystore \
  -alias wakeme-key \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

입력 항목 예시:
- 키스토어 비밀번호: (강한 비밀번호 설정)
- 이름과 성: WakeMe
- 조직 단위: Mobile
- 조직: WakeMe
- 도시: Daejeon
- 주/도: Chungcheongnam-do
- 국가 코드: KR

> **생성된 `wakeme-release.keystore` 파일은 절대 Git에 커밋하지 마세요.**
> `.gitignore`에 `android/app/release/` 항목이 있는지 확인하세요.

---

## 2. 서명 설정 (`android/app/build.gradle`)

키스토어 생성 후 `build.gradle`의 `signingConfigs`를 수정합니다:

```gradle
signingConfigs {
    release {
        storeFile file('release/wakeme-release.keystore')
        storePassword System.getenv("WAKEME_STORE_PASSWORD") ?: "여기에_비밀번호"
        keyAlias 'wakeme-key'
        keyPassword System.getenv("WAKEME_KEY_PASSWORD") ?: "여기에_비밀번호"
    }
    debug {
        storeFile file('debug.keystore')
        storePassword 'android'
        keyAlias 'androiddebugkey'
        keyPassword 'android'
    }
}

buildTypes {
    release {
        signingConfig signingConfigs.release   // debug → release 로 변경
        minifyEnabled enableProguardInReleaseBuilds
        proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
    }
    ...
}
```

환경변수로 관리하는 경우 (권장):
```bash
export WAKEME_STORE_PASSWORD="키스토어_비밀번호"
export WAKEME_KEY_PASSWORD="키_비밀번호"
```

---

## 3. 릴리즈 APK 빌드

### 기본 빌드 (모든 아키텍처 포함)
```bash
cd android && ./gradlew assembleRelease
```

### 아키텍처별 분리 APK (파일 크기 최소화, 권장)
```bash
cd android && ./gradlew assembleRelease -PuniversalApk=false
```

### 출력 위치
```
android/app/build/outputs/apk/release/
├── app-arm64-v8a-release.apk      # 최신 Android 기기 (64-bit)
├── app-armeabi-v7a-release.apk    # 구형 Android 기기 (32-bit)
├── app-x86_64-release.apk         # 에뮬레이터 (64-bit)
└── app-x86-release.apk            # 에뮬레이터 (32-bit)
```

실기기 테스트는 `app-arm64-v8a-release.apk` 사용.

---

## 4. APK 서명 확인

```bash
jarsigner -verify -verbose -certs \
  android/app/build/outputs/apk/release/app-arm64-v8a-release.apk
```

---

## 5. 기기에 직접 설치 (ADB)

```bash
adb install android/app/build/outputs/apk/release/app-arm64-v8a-release.apk
```

기존 앱 덮어쓰기:
```bash
adb install -r android/app/build/outputs/apk/release/app-arm64-v8a-release.apk
```

---

## 6. 버전 업데이트 (`android/app/build.gradle`)

배포 전 버전을 올려줍니다:

```gradle
defaultConfig {
    versionCode 2          // 배포할 때마다 +1 (정수)
    versionName "1.1.0"    // 사용자에게 보이는 버전
}
```

---

## 7. Google Play 배포용 AAB 빌드

### AAB 빌드 명령어
```bash
cd android && ./gradlew bundleRelease
```

### 출력 위치
```
android/app/build/outputs/bundle/release/app-release.aab
```

### 키스토어 정보 (local.properties에 저장됨 — gitignore)
| 항목 | 값 |
|------|----|
| JKS 경로 | `/Users/ijeongho/GitHub/wakeme/jks/wakeme.jks` |
| alias | `wakeme` |
| 비밀번호 | `local.properties` → `WAKEME_STORE_PASSWORD` |

> 비밀번호는 `android/local.properties`에만 저장되며 Git에 커밋되지 않습니다.

### ADB로 직접 설치 불가 — Google Play 업로드 전용
> AAB는 기기에 직접 설치할 수 없습니다. 테스트는 APK(`assembleRelease`)를 사용하고,
> Google Play Console 업로드 시에만 AAB를 사용하세요.

### 전체 빌드 → 업로드 한 줄 요약
```bash
# 1. JS 번들 + AAB 생성
cd android && ./gradlew bundleRelease

# 2. 출력 파일 확인
ls -lh app/build/outputs/bundle/release/app-release.aab
```

---

## 참고: 현재 빌드 환경

| 항목 | 값 |
|------|----|
| applicationId | com.wakeme_mobile |
| 현재 versionCode | 1 |
| 현재 versionName | 1.0 |
| 아키텍처 | armeabi-v7a, arm64-v8a, x86, x86_64 |
| Hermes | 활성화 |
| New Architecture | 활성화 |
