import notifee, {
  AndroidImportance,
  AndroidNotificationSetting,
  TriggerType,
  RepeatFrequency,
} from '@notifee/react-native';

const CHANNEL_ID = 'wakeme-alert';

/** 알림 채널 초기화 (앱 시작 시 1회 호출) */
export async function setupNotificationChannel(): Promise<void> {
  await notifee.createChannel({
    id: CHANNEL_ID,
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
      channelId: CHANNEL_ID,
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
      channelId: CHANNEL_ID,
      importance: AndroidImportance.HIGH,
      pressAction: { id: 'default' },
      vibrationPattern: [0, 500, 200, 500],
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

/** 출발 시간 트리거 알림 예약 (매일 반복) */
export async function scheduleDepartureNotification(
  routeId: string,
  routeName: string,
  departTime: string, // "HH:MM"
): Promise<void> {
  await setupNotificationChannel();
  const [hour, minute] = departTime.split(':').map(Number);

  const now = new Date();
  const trigger = new Date();
  trigger.setHours(hour, minute, 0, 0);
  if (trigger.getTime() <= now.getTime()) {
    trigger.setDate(trigger.getDate() + 1);
  }

  await notifee.createTriggerNotification(
    {
      id: `departure-${routeId}`,
      title: '🚌 출발 시간입니다!',
      body: `${routeName} 경로를 시작할 시간이에요`,
      android: {
        channelId: CHANNEL_ID,
        importance: AndroidImportance.HIGH,
        pressAction: { id: 'default' },
        vibrationPattern: [0, 300, 200, 300],
      },
    },
    {
      type: TriggerType.TIMESTAMP,
      timestamp: trigger.getTime(),
      repeatFrequency: RepeatFrequency.DAILY,
      alarmManager: { allowWhileIdle: true },
    },
  );
}

/** 출발 시간 알림 취소 */
export async function cancelDepartureNotification(routeId: string): Promise<void> {
  await notifee.cancelNotification(`departure-${routeId}`);
}
