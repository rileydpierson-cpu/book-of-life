import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAppTheme } from '../theme/theme-provider';
import { useMobileApp } from '../app/mobile-app-provider';
import type { RootStackParamList } from './types';
import { HomeTimelineScreen } from '../screens/home-timeline-screen';
import { ExplorerScreen } from '../screens/explorer-screen';
import { SearchScreen } from '../screens/search-screen';
import { JournalEditorScreen } from '../screens/journal-editor-screen';
import { MediaViewerScreen } from '../screens/media-viewer-screen';
import { SettingsScreen } from '../screens/settings-screen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { theme } = useAppTheme();
  const { ready, status } = useMobileApp();

  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.background,
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.spacing.xl,
          gap: theme.spacing.md
        }}
      >
        <ActivityIndicator size="large" color={theme.colors.accent} />
        <Text style={{ color: theme.colors.textMuted, textAlign: 'center' }}>{status}</Text>
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: {
          backgroundColor: theme.colors.background
        }
      }}
    >
      <Stack.Screen name="HomeTimeline" component={HomeTimelineScreen} />
      <Stack.Screen name="Explorer" component={ExplorerScreen} />
      <Stack.Screen name="Search" component={SearchScreen} />
      <Stack.Screen name="JournalEditor" component={JournalEditorScreen} />
      <Stack.Screen
        name="MediaViewer"
        component={MediaViewerScreen}
        options={{ presentation: 'fullScreenModal', animation: 'fade_from_bottom' }}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          animation: 'slide_from_left',
          gestureEnabled: true
        }}
      />
    </Stack.Navigator>
  );
}
