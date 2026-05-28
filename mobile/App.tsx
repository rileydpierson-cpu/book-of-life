import React from 'react';
import { ActivityIndicator, Platform, Text, View } from 'react-native';
import { NavigationContainer, DefaultTheme as NavigationDefaultTheme } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import * as NavigationBar from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import { LavishlyYours_400Regular } from '@expo-google-fonts/lavishly-yours';
import { RootNavigator } from './src/navigation/root-navigator';
import { ThemeProvider, useAppTheme } from './src/theme/theme-provider';
import { MobileAppProvider } from './src/app/mobile-app-provider';

function NavigationShell() {
  const { theme, themeName } = useAppTheme();

  React.useEffect(() => {
    if (Platform.OS !== 'android') return;
    NavigationBar.setButtonStyleAsync(themeName === 'dark' ? 'light' : 'dark').catch(() => {});
  }, [themeName]);

  return (
    <>
      <StatusBar
        style={themeName === 'dark' ? 'light' : 'dark'}
        backgroundColor={theme.colors.background}
      />
      <NavigationContainer
        theme={{
          ...NavigationDefaultTheme,
          colors: {
            ...NavigationDefaultTheme.colors,
            background: theme.colors.background,
            card: theme.colors.surface,
            text: theme.colors.text,
            border: theme.colors.border,
            primary: theme.colors.accent
          }
        }}
      >
        <MobileAppProvider>
          <RootNavigator />
        </MobileAppProvider>
      </NavigationContainer>
    </>
  );
}

function StartupScreen() {
  const { theme } = useAppTheme();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.background,
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.md
      }}
    >
      <ActivityIndicator size="large" color={theme.colors.accent} />
      <Text
        style={{
          color: theme.colors.textMuted,
          fontSize: 15
        }}
      >
        Loading mobile shell...
      </Text>
    </View>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    LavishlyYours_400Regular
  });

  return (
    <ThemeProvider fontsLoaded={fontsLoaded}>
      {fontsLoaded ? <NavigationShell /> : <StartupScreen />}
    </ThemeProvider>
  );
}
