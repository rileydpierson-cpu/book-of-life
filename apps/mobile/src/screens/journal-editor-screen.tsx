import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ArrowLeft, Check, ImagesSquare } from 'phosphor-react-native';
import { buildEditorEntry } from '../app/mobile-library';
import { useMobileApp } from '../app/mobile-app-provider';
import { useAppTheme } from '../theme/theme-provider';
import { IconButton, ScreenShell, StatusPill, SurfaceCard, Topbar } from '../components/primitives';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'JournalEditor'>;

function journalTone(status: ReturnType<typeof buildEditorEntry>['journalStatus']) {
  if (status === 'synced') return 'green' as const;
  if (status === 'pending') return 'amber' as const;
  return 'gray' as const;
}

export function JournalEditorScreen({ navigation, route }: Props) {
  const { theme } = useAppTheme();
  const { library, entryRows, saveJournal, status } = useMobileApp();
  const editorEntry = useMemo(() => buildEditorEntry({
    snapshot: library,
    entryRows,
    isoDate: route.params.isoDate
  }), [library, entryRows, route.params.isoDate]);
  const [value, setValue] = useState(editorEntry.raw);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(editorEntry.raw);
  }, [editorEntry.raw, editorEntry.isoDate]);

  return (
    <ScreenShell scroll contentContainerStyle={{ gap: theme.spacing.md }}>
      <Topbar
        title="Journal Editor"
        subtitle={editorEntry.title}
        lead={<IconButton icon={ArrowLeft} label="Back" onPress={() => navigation.goBack()} />}
        actions={<IconButton icon={Check} label="Save" onPress={handleSave} filled />}
      />

      <SurfaceCard>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.md, alignItems: 'center' }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: theme.colors.text, fontSize: 20, fontWeight: '700' }}>{editorEntry.isoDate}</Text>
            <Text style={{ color: theme.colors.textMuted }}>{editorEntry.wordCount} words • {editorEntry.mediaItems.length} media items</Text>
          </View>
          <StatusPill label={saving ? 'saving' : editorEntry.journalStatus} tone={saving ? 'amber' : journalTone(editorEntry.journalStatus)} />
        </View>
        <Text style={{ color: theme.colors.textMuted, marginTop: 10 }}>{status}</Text>
      </SurfaceCard>

      <SurfaceCard accent>
        <TextInput
          value={value}
          onChangeText={setValue}
          multiline
          textAlignVertical="top"
          placeholder="Write about the day"
          placeholderTextColor={theme.colors.textMuted}
          style={{
            minHeight: 340,
            color: theme.colors.text,
            fontSize: 16,
            lineHeight: 24
          }}
        />
      </SurfaceCard>

      <SurfaceCard>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.sm }}>
          <View>
            <Text style={{ color: theme.colors.text, fontSize: 20, fontWeight: '700' }}>Media Strip</Text>
            <Text style={{ color: theme.colors.textMuted }}>Full-screen editor with the day’s media nearby.</Text>
          </View>
          <ImagesSquare size={22} color={theme.colors.accent} weight="duotone" />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.sm }}>
          {editorEntry.mediaItems.length ? editorEntry.mediaItems.map((item) => (
            <Pressable
              key={item.key}
              onPress={() => navigation.navigate('MediaViewer', { initialItemKey: item.key, isoDate: editorEntry.isoDate })}
              style={{
                width: 112,
                height: 112,
                borderRadius: theme.radius.md,
                overflow: 'hidden',
                backgroundColor: theme.colors.surfaceMuted,
                padding: item.mediaType === 'video' ? theme.spacing.sm : 0,
                justifyContent: 'center'
              }}
            >
              {item.mediaType !== 'video' && (item.cachePath || item.assetUri) ? (
                <Image source={{ uri: item.cachePath || item.assetUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              ) : (
                <View style={{ padding: theme.spacing.sm, gap: 6 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: '700' }} numberOfLines={2}>{item.fileName}</Text>
                  <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.meta }}>{item.mediaType.toUpperCase()}</Text>
                </View>
              )}
            </Pressable>
          )) : (
            <Text style={{ color: theme.colors.textMuted }}>No media is attached to this day yet.</Text>
          )}
        </ScrollView>
      </SurfaceCard>
    </ScreenShell>
  );

  async function handleSave() {
    try {
      setSaving(true);
      await saveJournal({ isoDate: editorEntry.isoDate, raw: value });
    } finally {
      setSaving(false);
    }
  }
}
