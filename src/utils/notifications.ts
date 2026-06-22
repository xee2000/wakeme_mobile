import notifee, {
  AndroidImportance,
  AndroidNotificationSetting,
  TriggerType,
  RepeatFrequency,
} from '@notifee/react-native';
// TriggerType, RepeatFrequency — scheduleDepartureNotification 에서 사용

// 포그라운드 서비스 유지용 (낮은 우선순위 — 조용히 상단바에만 표시)
export const CHANNEL_TRACKING = 'wakeme-tracking';
// 실제 하차 이벤트 알림용 (높은 우선순위 — 소리·진동)
export const CHANNEL_ALERT = 'wakeme-alert';

/** 알림 채널 초기화 (앱 시작 시 1회 호출) */
export async function setupNotificationChannel(): Promise<void> {
  await notifee.createChannel({
    id: CHANNEL_TRACKING,
    name: 'WakeMe 모니터링 중',
    importance: AndroidImportance.LOW,
    sound: undefined,
    vibration: false,
  });
  await notifee.createChannel({
    id: CHANNEL_ALERT,
    name: 'WakeMe 하차 알림',
    importance: AndroidImportance.HIGH,
    sound: 'default',
    vibration: true,
  });
}

/** 하차 준비 알림 (300m 전) */
export async function sendPrepareNotification(stopName: string): Promise<void> {
  await notifee.displayNotification({
    title: '🔔 곧 하차할 정류장입니다',
    body: `다음 정류장 "${stopName}" 에서 준비하세요!`,
    android: {
      channelId: CHANNEL_ALERT,
      importance: AndroidImportance.HIGH,
      pressAction: { id: 'default' },
    },
    ios: {
      sound: 'default',
    },
  });
}

/** 하차 알림 (150m) */
export async function sendExitNotification(stopName: string): Promise<void> {
  await notifee.displayNotification({
    title: '🚨 지금 내리세요!',
    body: `"${stopName}" 정류장입니다. 지금 내리세요!`,
    android: {
      channelId: CHANNEL_ALERT,
      importance: AndroidImportance.HIGH,
      pressAction: { id: 'default' },
      vibrationPattern: [100, 500, 200, 500],
    },
    ios: {
      sound: 'default',
      critical: true,
      criticalVolume: 1.0,
    },
  });
}

/** 알림 권한 요청 */
export async function requestNotificationPermission(): Promise<boolean> {
  const settings = await notifee.requestPermission();
  return settings.android?.alarm === AndroidNotificationSetting.ENABLED;
}

/**
 * 출발 시간 알림 예약 — 다음 유효한 운행 요일에만 1회 예약
 * 앱 시작 시 rescheduleDepartureAlarms() 에서 매번 재등록되므로 DAILY repeat 불필요
 */
export async function scheduleDepartureNotification(
  routeId: string,
  routeName: string,
  departTime: string,   // "HH:MM"
  daysOfWeek?: number[], // 0=일,1=월,...,6=토. 미지정이면 매일
): Promise<void> {
  await setupNotificationChannel();
  const [hour, minute] = departTime.split(':').map(Number);
  const validDays = daysOfWeek && daysOfWeek.length > 0 ? daysOfWeek : [0, 1, 2, 3, 4, 5, 6];

  // 오늘부터 최대 7일 내 다음 유효한 운행일 탐색
  const now = new Date();
  let trigger: Date | null = null;
  for (let d = 0; d <= 7; d++) {
    const candidate = new Date();
    candidate.setDate(now.getDate() + d);
    candidate.setHours(hour, minute, 0, 0);
    if (candidate.getTime() > now.getTime() && validDays.includes(candidate.getDay())) {
      trigger = candidate;
      break;
    }
  }
  if (!trigger) return; // 유효한 운행일 없음 — 알림 등록 안 함

  await notifee.createTriggerNotification(
    {
      id: `departure-${routeId}`,
      title: '🚌 출발 시간입니다!',
      body: `${routeName} — 앱을 열어 출발을 준비하세요`,
      android: {
        channelId: CHANNEL_ALERT,
        importance: AndroidImportance.HIGH,
        pressAction: { id: 'default' },
        vibrationPattern: [100, 300, 200, 300],
      },
    },
    {
      type: TriggerType.TIMESTAMP,
      timestamp: trigger.getTime(),
      alarmManager: { allowWhileIdle: true },
    },
  );
}

/** 출발 시간 알림 취소 */
export async function cancelDepartureNotification(routeId: string): Promise<void> {
  await notifee.cancelNotification(`departure-${routeId}`);
}

