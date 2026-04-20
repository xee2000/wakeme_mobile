/**
 * @format
 */

// Supabase가 React Native에서 URL 객체를 올바르게 사용하도록 폴리필 (최상단 필수)
import 'react-native-url-polyfill/auto';

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
