import React, { useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LockKey, SignIn as SignInIcon } from 'phosphor-react-native';
import { useMobileApp } from '../app/mobile-app-provider';
import { PrimaryButton, ScreenShell, SecondaryButton, SurfaceCard } from '../components/primitives';
import type { RootStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/theme-provider';

type Props = NativeStackScreenProps<RootStackParamList, 'SignIn'> & {
  onContinueWithoutSignIn: () => void;
};

export function SignInScreen({ route, navigation, onContinueWithoutSignIn }: Props) {
  const { theme } = useAppTheme();
  const { signInAndSync, connection, status } = useMobileApp();
  const allowSkip = route.params?.allowSkip !== false;
  const [serverUrl, setServerUrl] = useState(connection?.serverUrl || 'http://127.0.0.1:3000');
  const [username, setUsername] = useState(connection?.username || '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const inputStyle = useMemo(() => ({
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.colors.text,
    backgroundColor: theme.colors.surface
  }), [theme.colors.border, theme.colors.surface, theme.colors.text, theme.radius.md]);

  return (
    <ScreenShell scroll>
      <View style={{ flex: 1, justifyContent: 'space-between', gap: theme.spacing.lg, paddingVertical: theme.spacing.lg }}>
        <View style={{ gap: theme.spacing.md }}>
          <SurfaceCard accent>
            <View style={{ gap: theme.spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                <LockKey size={22} color={theme.colors.accent} weight="duotone" />
                <Text style={{ color: theme.colors.text, fontSize: 22, fontWeight: '800' }}>Sign In</Text>
              </View>
              <Text style={{ color: theme.colors.textMuted, lineHeight: 22 }}>
                Sign in to sync journals and media with your Book of Life server. You can still use the app locally without signing in.
              </Text>
            </View>
          </SurfaceCard>

          <SurfaceCard>
            <View style={{ gap: theme.spacing.sm }}>
              <Text style={{ color: theme.colors.textMuted }}>Server URL</Text>
              <TextInput
                value={serverUrl}
                onChangeText={setServerUrl}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="http://127.0.0.1:3000"
                placeholderTextColor={theme.colors.textMuted}
                style={inputStyle}
              />
              <Text style={{ color: theme.colors.textMuted }}>Username</Text>
              <TextInput
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="your-name"
                placeholderTextColor={theme.colors.textMuted}
                style={inputStyle}
              />
              <Text style={{ color: theme.colors.textMuted }}>Password</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Enter your password"
                placeholderTextColor={theme.colors.textMuted}
                style={inputStyle}
              />
              {!!error ? <Text style={{ color: theme.colors.destructive }}>{error}</Text> : null}
              <PrimaryButton
                label={busy ? 'Signing In...' : 'Sign In'}
                icon={<SignInIcon size={18} color={theme.colors.onAccent} weight="bold" />}
                onPress={() => void handleSignIn()}
                fullWidth
              />
              <Text style={{ color: theme.colors.textMuted, lineHeight: 20 }}>{status}</Text>
            </View>
          </SurfaceCard>
        </View>

        {allowSkip ? (
          <SecondaryButton
            label="Continue without signin"
            onPress={() => {
              onContinueWithoutSignIn();
            }}
            fullWidth
          />
        ) : (
          <SecondaryButton
            label="Back to settings"
            onPress={() => navigation.goBack()}
            fullWidth
          />
        )}
      </View>
    </ScreenShell>
  );

  async function handleSignIn() {
    try {
      setBusy(true);
      setError('');
      await signInAndSync(serverUrl.trim(), username.trim(), password);
    } catch (nextError) {
      setError((nextError as Error).message || 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  }
}
