import React from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, Text, View } from 'react-native';
import { NavigationContainer, DefaultTheme as NavigationDefaultTheme } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import * as NavigationBar from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import { LavishlyYours_400Regular } from '@expo-google-fonts/lavishly-yours';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { RootNavigator } from './src/navigation/root-navigator';
import { ThemeProvider, useAppTheme } from './src/theme/theme-provider';
import { MobileAppProvider } from './src/app/mobile-app-provider';

const LOCAL_APP_ORIGIN = process.env.EXPO_PUBLIC_BOOK_OF_LIFE_LOCAL_APP_ORIGIN || 'http://127.0.0.1:3199';
const LOCAL_APP_URL = `${LOCAL_APP_ORIGIN}/`;

function NativeNavigationShell() {
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

function MobileWebViewShell() {
  const { theme, themeName } = useAppTheme();
  const webViewRef = React.useRef<WebView>(null);
  const [nativeFallback, setNativeFallback] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [webViewKey, setWebViewKey] = React.useState(0);

  React.useEffect(() => {
    if (Platform.OS !== 'android') return;
    NavigationBar.setButtonStyleAsync(themeName === 'dark' ? 'light' : 'dark').catch(() => {});
    NavigationBar.setBackgroundColorAsync(theme.colors.background).catch(() => {});
  }, [theme.colors.background, themeName]);

  if (nativeFallback) return <NativeNavigationShell />;

  return (
    <SafeAreaProvider>
      <StatusBar
        style={themeName === 'dark' ? 'light' : 'dark'}
        backgroundColor={theme.colors.background}
      />
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top', 'bottom']}>
        <View
          style={{
            minHeight: 48,
            paddingHorizontal: 12,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8
          }}
        >
          <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '800' }}>Book of Life</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <ShellButton label="Reload" onPress={() => webViewRef.current?.reload()} />
            <ShellButton
              label="Restart"
              onPress={() => {
                setWebViewKey((current) => current + 1);
              }}
            />
            <ShellButton label="Native" onPress={() => setNativeFallback(true)} />
          </View>
        </View>

        <View style={{ flex: 1 }}>
          <WebView
            key={webViewKey}
            ref={webViewRef}
            source={{ uri: LOCAL_APP_URL }}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            domStorageEnabled
            startInLoadingState
            allowsBackForwardNavigationGestures
            pullToRefreshEnabled
            setSupportMultipleWindows={false}
            onLoadStart={() => {
              setLoading(true);
              setError('');
            }}
            onLoadEnd={() => setLoading(false)}
            onError={(event) => {
              setLoading(false);
              setError(event.nativeEvent.description || 'Could not load the local Book of Life service.');
            }}
            onHttpError={(event) => {
              if (event.nativeEvent.statusCode >= 500) {
                setError(`Local service returned ${event.nativeEvent.statusCode}.`);
              }
            }}
            onShouldStartLoadWithRequest={(request) => {
              if (
                request.url.startsWith(LOCAL_APP_ORIGIN) ||
                request.url.startsWith('http://127.0.0.1:3199') ||
                request.url.startsWith('about:blank')
              ) {
                return true;
              }
              Linking.openURL(request.url).catch(() => {});
              return false;
            }}
            onNavigationStateChange={(navigation: WebViewNavigation) => {
              if (!navigation.loading) setLoading(false);
            }}
            style={{ backgroundColor: theme.colors.background }}
          />

          {loading ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: `${theme.colors.background}dd`,
                gap: theme.spacing.sm
              }}
            >
              <ActivityIndicator size="large" color={theme.colors.accent} />
              <Text style={{ color: theme.colors.textMuted }}>Starting local library...</Text>
            </View>
          ) : null}

          {error ? (
            <View
              style={{
                position: 'absolute',
                left: 16,
                right: 16,
                bottom: 16,
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
                borderWidth: 1,
                borderRadius: theme.radius.md,
                padding: 14,
                gap: 10
              }}
            >
              <Text style={{ color: theme.colors.text, fontWeight: '800' }}>Local app unavailable</Text>
              <Text style={{ color: theme.colors.textMuted, lineHeight: 20 }}>{error}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <ShellButton label="Try again" onPress={() => webViewRef.current?.reload()} />
                <ShellButton label="Open native fallback" onPress={() => setNativeFallback(true)} />
              </View>
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function ShellButton(props: { label: string; onPress: () => void }) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      onPress={props.onPress}
      style={{
        minHeight: 34,
        paddingHorizontal: 10,
        borderRadius: theme.radius.sm,
        backgroundColor: theme.colors.background,
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: '800' }}>{props.label}</Text>
    </Pressable>
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
      {fontsLoaded ? <MobileWebViewShell /> : <StartupScreen />}
    </ThemeProvider>
  );
}
