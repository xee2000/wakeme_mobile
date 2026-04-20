import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuthStore } from '../store/useAuthStore';
import { RootStackParamList } from '../types';

import LoginScreen from '../screens/LoginScreen';
import HomeScreen from '../screens/HomeScreen';
import RouteListScreen from '../screens/RouteListScreen';
import RouteRegisterScreen from '../screens/RouteRegisterScreen';
import RouteActiveScreen from '../screens/RouteActiveScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  const isLoggedIn = useAuthStore(s => s.isLoggedIn);

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: '#1A73E8' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
        }}>
        {!isLoggedIn ? (
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ headerShown: false }}
          />
        ) : (
          <>
            <Stack.Screen
              name="Home"
              component={HomeScreen}
              options={{ title: 'WakeMe' }}
            />
            <Stack.Screen
              name="RouteList"
              component={RouteListScreen}
              options={{ title: '내 경로' }}
            />
            <Stack.Screen
              name="RouteRegister"
              component={RouteRegisterScreen}
              options={{ title: '경로 등록' }}
            />
            <Stack.Screen
              name="RouteActive"
              component={RouteActiveScreen}
              options={{ title: '알림 활성화' }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
