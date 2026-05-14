import React, { useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ArrowLeft, CalendarDots, CloudArrowUp, Palette, PlusSquare, SignIn, SignOut } from 'phosphor-react-native';
import { useMobileApp } from '../app/mobile-app-provider';
import { THEMES } from '../theme/themes';
import { useAppTheme } from '../theme/theme-provider';
import { EmptyState, IconButton, PrimaryButton, ScreenShell, SectionHeader, SecondaryButton, SurfaceCard, ThemeChoiceChip, Topbar } from '../components/primitives';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

export function SettingsScreen({ navigation }: Props) {
  const { theme, themeName, setThemeName } = useAppTheme();
  const {
    status,
    connection,
    syncStats,
    deviceFolderSummary,
    signOut,
    performConnectedSync,
    registerFolder,
    scanAndUploadMedia,
    buildTodayIsoDate
  } = useMobileApp();
  const [jumpDate, setJumpDate] = useState(buildTodayIsoDate());
  const [busyKey, setBusyKey] = useState('');

  const folderSummaryLabel = useMemo(() => (
    deviceFolderSummary.folders.length
      ? `${deviceFolderSummary.folders.length} folder(s), ${deviceFolderSummary.assetCount} indexed asset(s)`
      : 'No device folders selected'
  ), [deviceFolderSummary]);

  return (
    <ScreenShell scroll>
      <Topbar
        title="Settings"
        subtitle="Sync, quick actions, and appearance"
        lead={<IconButton icon={ArrowLeft} label="Back" onPress={() => navigation.goBack()} />}
      />

      <SurfaceCard accent>
        <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '700' }}>Book of Life</Text>
        <Text style={{ color: theme.colors.textMuted, marginTop: 6, lineHeight: 21 }}>
          Quick controls for browsing, capturing, syncing, and customizing the mobile library.
        </Text>
        <Text style={{ color: theme.colors.textMuted, marginTop: 10 }}>{status}</Text>
      </SurfaceCard>

      <SectionHeader title="Quick Actions" subtitle="Match the web app’s utility actions in a native settings surface." />
      <View style={{ gap: theme.spacing.sm }}>
        <PrimaryButton
          label="Open Today"
          icon={<CalendarDots size={18} color={theme.colors.onAccent} weight="bold" />}
          onPress={() => navigation.navigate('JournalEditor', { isoDate: buildTodayIsoDate() })}
          fullWidth
        />
        <SecondaryButton
          label="Jump To Date"
          icon={<CalendarDots size={18} color={theme.colors.text} weight="bold" />}
          onPress={() => navigation.navigate('JournalEditor', { isoDate: jumpDate })}
          fullWidth
        />
        <TextInput
          value={jumpDate}
          onChangeText={setJumpDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={theme.colors.textMuted}
          style={{
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.md,
            paddingHorizontal: 14,
            paddingVertical: 12,
            color: theme.colors.text,
            backgroundColor: theme.colors.surface
          }}
        />
      </View>

      <SectionHeader title="Connection" subtitle={connection?.serverUrl || 'Not signed in to a sync server.'} />
      <SurfaceCard>
        <View style={{ gap: theme.spacing.sm }}>
          {connection?.authToken ? (
            <>
              <Text style={{ color: theme.colors.textMuted }}>
                Signed in{connection.username ? ` as ${connection.username}` : ''} on {connection.serverUrl}
              </Text>
              <PrimaryButton
                label={busyKey === 'sync' ? 'Syncing...' : 'Sync Now'}
                onPress={() => runBusy('sync', () => performConnectedSync({ reason: 'Manual sync' }))}
                fullWidth
              />
              <SecondaryButton
                label={busyKey === 'signout' ? 'Signing Out...' : 'Sign Out'}
                icon={<SignOut size={18} color={theme.colors.text} weight="bold" />}
                onPress={() => runBusy('signout', signOut)}
                fullWidth
              />
            </>
          ) : (
            <>
              <Text style={{ color: theme.colors.textMuted }}>
                Sign in when you want server sync. You can keep using the app locally without an account.
              </Text>
              <PrimaryButton
                label="Sign In To Sync"
                icon={<SignIn size={18} color={theme.colors.onAccent} weight="bold" />}
                onPress={() => navigation.navigate('SignIn', { allowSkip: false })}
                fullWidth
              />
            </>
          )}
          {syncStats ? (
            <Text style={{ color: theme.colors.textMuted }}>
              Checkpoint {syncStats.lastCheckpoint} | Pending {syncStats.pendingMutations} | Remote media {syncStats.syncedMediaItems}
            </Text>
          ) : null}
        </View>
      </SurfaceCard>

      <SectionHeader title="Device Media" subtitle={folderSummaryLabel} />
      <View style={{ gap: theme.spacing.sm }}>
        <PrimaryButton
          label={busyKey === 'register' ? 'Registering...' : 'Register Device Folder'}
          icon={<PlusSquare size={18} color={theme.colors.onAccent} weight="bold" />}
          onPress={() => runBusy('register', registerFolder)}
          fullWidth
        />
        <SecondaryButton
          label={busyKey === 'scan' ? 'Scanning...' : 'Scan And Upload Media'}
          icon={<CloudArrowUp size={18} color={theme.colors.text} weight="bold" />}
          onPress={() => runBusy('scan', scanAndUploadMedia)}
          fullWidth
        />
        {deviceFolderSummary.folders.length ? (
          <SurfaceCard accent>
            <View style={{ gap: 8 }}>
              {deviceFolderSummary.folders.map((folder) => (
                <View key={folder.id}>
                  <Text style={{ color: theme.colors.text, fontWeight: '700' }}>{folder.displayName}</Text>
                  <Text style={{ color: theme.colors.textMuted }}>{folder.folderUri}</Text>
                </View>
              ))}
            </View>
          </SurfaceCard>
        ) : (
          <EmptyState title="No device folders yet" message="Register a folder to scan local photos and queue them for upload." />
        )}
      </View>

      <SectionHeader title="Appearance" subtitle="Carry the web app’s theme choices into native surfaces." />
      <SurfaceCard>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {Object.keys(THEMES).map((name) => (
            <ThemeChoiceChip
              key={name}
              label={name[0].toUpperCase() + name.slice(1)}
              active={themeName === name}
              onPress={() => setThemeName(name as keyof typeof THEMES)}
            />
          ))}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
          <Palette size={18} color={theme.colors.accent} weight="duotone" />
          <Text style={{ color: theme.colors.textMuted }}>
            Theme changes apply across timeline, explorer, search, editor, viewer, and settings.
          </Text>
        </View>
      </SurfaceCard>
    </ScreenShell>
  );

  async function runBusy(key: string, task: () => Promise<void>) {
    try {
      setBusyKey(key);
      await task();
    } finally {
      setBusyKey('');
    }
  }
}
