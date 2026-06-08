import React from 'react';
import { ActivityIndicator, Linking, PermissionsAndroid, Platform, Pressable, Text, View } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';

const LOCAL_APP_ORIGIN = process.env.EXPO_PUBLIC_BOOK_OF_LIFE_LOCAL_APP_ORIGIN || 'http://127.0.0.1:3199';
const LOCAL_APP_URL = `${LOCAL_APP_ORIGIN}/`;

const colors = {
  background: '#f6f1e8',
  surface: '#fffaf0',
  border: '#dccfb9',
  text: '#221d18',
  muted: '#6e6458',
  accent: '#2f5f87',
  onAccent: '#ffffff'
};

export default function App() {
  const webViewRef = React.useRef<WebView>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [webViewKey, setWebViewKey] = React.useState(0);

  React.useEffect(() => {
    if (Platform.OS !== 'android') return;
    NavigationBar.setButtonStyleAsync('dark').catch(() => {});
    const permissions = Number(Platform.Version) >= 33
      ? [PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES, PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO]
      : [PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE];
    PermissionsAndroid.requestMultiple(permissions).catch(() => {});
  }, []);

  function reloadLocalApp() {
    setError('');
    setLoading(true);
    webViewRef.current?.reload();
  }

  function restartLocalAppView() {
    setError('');
    setLoading(true);
    setWebViewKey((current) => current + 1);
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" backgroundColor={colors.background} />
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
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
            style={{ backgroundColor: colors.background }}
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
                backgroundColor: colors.background,
                gap: 10
              }}
            >
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={{ color: colors.muted }}>Starting local library...</Text>
            </View>
          ) : null}

          {error ? (
            <View
              style={{
                position: 'absolute',
                left: 16,
                right: 16,
                bottom: 16,
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderWidth: 1,
                borderRadius: 8,
                padding: 14,
                gap: 10
              }}
            >
              <Text style={{ color: colors.text, fontWeight: '800' }}>Local app unavailable</Text>
              <Text style={{ color: colors.muted, lineHeight: 20 }}>{error}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <ShellButton label="Reload" onPress={reloadLocalApp} />
                <ShellButton label="Restart view" onPress={restartLocalAppView} />
              </View>
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function ShellButton(props: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        minHeight: 38,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: colors.accent,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.84 : 1
      })}
    >
      <Text style={{ color: colors.onAccent, fontSize: 13, fontWeight: '800' }}>{props.label}</Text>
    </Pressable>
  );
}
