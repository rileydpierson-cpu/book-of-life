import React from 'react';
import { ActivityIndicator, Linking, PermissionsAndroid, Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';
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
  const [setup, setSetup] = React.useState<any>(null);
  const [progress, setProgress] = React.useState<any>(null);
  const [cloudOriginalsEnabled, setCloudOriginalsEnabled] = React.useState(false);
  const [desktopBackupEnabled, setDesktopBackupEnabled] = React.useState(false);
  const [allowMobileData, setAllowMobileData] = React.useState(false);
  const [desktopTargetDeviceId, setDesktopTargetDeviceId] = React.useState('');
  const [setupError, setSetupError] = React.useState('');
  const [savingSetup, setSavingSetup] = React.useState(false);
  const bootstrapWasRunning = React.useRef(false);

  React.useEffect(() => {
    if (Platform.OS !== 'android') return;
    NavigationBar.setButtonStyleAsync('dark').catch(() => {});
    const permissions = Number(Platform.Version) >= 33
      ? [PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES, PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO, PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS]
      : [PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE];
    PermissionsAndroid.requestMultiple(permissions).catch(() => {});
  }, []);

  React.useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const [setupResponse, progressResponse] = await Promise.all([
          fetch(`${LOCAL_APP_ORIGIN}/api/mobile/setup`, { cache: 'no-store' }),
          fetch(`${LOCAL_APP_ORIGIN}/api/mobile/bootstrap/status`, { cache: 'no-store' })
        ]);
        const nextSetup = await setupResponse.json();
        const nextProgress = await progressResponse.json();
        if (!active) return;
        setSetup(nextSetup);
        setProgress(nextProgress);
        if (nextProgress.running) bootstrapWasRunning.current = true;
        if (bootstrapWasRunning.current && !nextProgress.running && nextSetup.initialBootstrapCompletedAt) {
          bootstrapWasRunning.current = false;
          setWebViewKey((current) => current + 1);
        }
      } catch {
        // The local service may still be starting.
      }
    }
    poll();
    const timer = setInterval(poll, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  async function saveSetup() {
    setSavingSetup(true);
    setSetupError('');
    try {
      const response = await fetch(`${LOCAL_APP_ORIGIN}/api/mobile/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cloudOriginalsEnabled, desktopBackupEnabled, desktopTargetDeviceId, allowMobileData })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not save backup settings.');
      bootstrapWasRunning.current = true;
      setProgress({ running: true, phase: 'bootstrap', message: 'Starting initial sync', percent: 0 });
    } catch (nextError: any) {
      setSetupError(nextError.message || 'Could not save backup settings.');
    } finally {
      setSavingSetup(false);
    }
  }

  async function retryBootstrap() {
    await fetch(`${LOCAL_APP_ORIGIN}/api/mobile/bootstrap`, { method: 'POST' });
    bootstrapWasRunning.current = true;
  }

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

          {setup?.setupRequired && !progress?.running ? (
            <View style={{ position: 'absolute', inset: 0, backgroundColor: colors.background }}>
              <ScrollView contentContainerStyle={{ padding: 22, gap: 18, flexGrow: 1, justifyContent: 'center' }}>
                <Text style={{ color: colors.text, fontSize: 28, fontWeight: '800' }}>Set up photo backup</Text>
                <Text style={{ color: colors.muted, lineHeight: 21 }}>Choose where originals from this phone should be protected before downloading your shared library index.</Text>
                <SetupToggle label="Backup photos on this device to the cloud" value={cloudOriginalsEnabled} onChange={setCloudOriginalsEnabled} />
                <SetupToggle label="Backup photos to another device" value={desktopBackupEnabled} onChange={setDesktopBackupEnabled} />
                {desktopBackupEnabled ? (
                  <View style={{ gap: 8 }}>
                    <Text style={{ color: colors.text, fontWeight: '800' }}>Choose a desktop</Text>
                    {(setup.desktopCandidates || []).map((device: any) => (
                      <Pressable
                        key={device.id}
                        disabled={!device.online}
                        onPress={() => setDesktopTargetDeviceId(device.id)}
                        style={{
                          padding: 13,
                          borderWidth: 1,
                          borderColor: desktopTargetDeviceId === device.id ? colors.accent : colors.border,
                          backgroundColor: colors.surface,
                          borderRadius: 8,
                          opacity: device.online ? 1 : 0.45
                        }}
                      >
                        <Text style={{ color: colors.text, fontWeight: '800' }}>{device.name}</Text>
                        <Text style={{ color: colors.muted }}>{device.online ? 'Online and ready to confirm' : 'Offline'}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                <SetupToggle label="Use mobile data for original backups" value={allowMobileData} onChange={setAllowMobileData} />
                {setupError ? <Text style={{ color: '#a02b35' }}>{setupError}</Text> : null}
                <ShellButton label={savingSetup ? 'Saving...' : 'Continue'} onPress={saveSetup} disabled={savingSetup || (desktopBackupEnabled && !desktopTargetDeviceId)} />
              </ScrollView>
            </View>
          ) : null}

          {progress?.running ? (
            <View style={{ position: 'absolute', inset: 0, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 }}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={{ color: colors.text, fontSize: 24, fontWeight: '800', textAlign: 'center' }}>Getting your library ready</Text>
              <Text style={{ color: colors.muted, textAlign: 'center' }}>{progress.message || 'Downloading media index and device folders'}</Text>
              {progress.total > 0 ? <Text style={{ color: colors.muted }}>{progress.current} of {progress.total} · {progress.percent}%</Text> : null}
            </View>
          ) : null}

          {!progress?.running && setup?.initialBootstrapError && !setup?.initialBootstrapCompletedAt ? (
            <View style={{ position: 'absolute', left: 16, right: 16, bottom: 16, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 14, gap: 10 }}>
              <Text style={{ color: colors.text, fontWeight: '800' }}>Initial sync needs attention</Text>
              <Text style={{ color: colors.muted }}>{setup.initialBootstrapError}</Text>
              <ShellButton label="Retry sync" onPress={retryBootstrap} />
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function SetupToggle(props: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={{ minHeight: 58, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <Text style={{ color: colors.text, fontWeight: '700', flex: 1 }}>{props.label}</Text>
      <Switch value={props.value} onValueChange={props.onChange} trackColor={{ true: colors.accent }} />
    </View>
  );
}

function ShellButton(props: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      style={({ pressed }) => ({
        minHeight: 38,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: colors.accent,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: props.disabled ? 0.45 : (pressed ? 0.84 : 1)
      })}
    >
      <Text style={{ color: colors.onAccent, fontSize: 13, fontWeight: '800' }}>{props.label}</Text>
    </Pressable>
  );
}
