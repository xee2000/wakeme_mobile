# WakeMe fastlane 자동 배포

## 1회 초기 설정 — Google Play 서비스 계정 JSON 발급

1. [Google Play Console](https://play.google.com/console) → 설정 → API 액세스
2. **서비스 계정 만들기** → Google Cloud Console로 이동
3. IAM → 서비스 계정 → 키 만들기 → JSON 다운로드
4. Play Console로 돌아와 해당 서비스 계정에 **내부 테스트 출시 관리자** 권한 부여
5. 다운로드한 JSON을 아래 경로에 저장:
   ```
   ~/secrets/wakeme-play-store.json
   ```
   (또는 환경 변수로: `export PLAY_STORE_JSON_KEY=/your/path/key.json`)

---

## 사용법

```bash
# 내부 테스트 자동 업로드 (버전 자동 올림 + AAB 빌드 + 업로드)
bundle exec fastlane internal

# 메이저 버전 올리고 싶을 때 (1.5 → 2.0)
bundle exec fastlane internal bump:major

# 업로드 없이 AAB만 빌드
bundle exec fastlane build_only
```

## 버전 규칙

| bump 옵션 | 예시 |
|-----------|------|
| (기본) minor | 1.5 → 1.6 |
| major | 1.5 → 2.0 |
| patch | 1.5 → 1.5.1 |

- `versionCode`는 항상 +1 자동 증가
- `versionName`은 bump 타입에 따라 증가

## 파일 위치

- `fastlane/Fastfile` — 레인 정의
- `fastlane/Appfile` — 패키지명 + 서비스 계정 키 경로
