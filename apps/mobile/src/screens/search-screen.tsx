import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ArrowLeft, MagnifyingGlass } from 'phosphor-react-native';
import { searchMobileLibrary } from '../app/mobile-library';
import { useMobileApp } from '../app/mobile-app-provider';
import { useAppTheme } from '../theme/theme-provider';
import { EmptyState, IconButton, ScreenShell, SearchField, SectionHeader, StatusPill, SurfaceCard, Topbar } from '../components/primitives';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Search'>;

export function SearchScreen({ navigation, route }: Props) {
  const { theme } = useAppTheme();
  const { library, entryRows } = useMobileApp();
  const [query, setQuery] = useState(route.params?.initialQuery || '');

  const results = useMemo(() => searchMobileLibrary({
    snapshot: library,
    entryRows,
    query
  }), [library, entryRows, query]);

  return (
    <ScreenShell scroll>
      <Topbar
        title="Search"
        subtitle="Local-first journal and media search"
        lead={<IconButton icon={ArrowLeft} label="Back" onPress={() => navigation.goBack()} />}
      />

      <SurfaceCard>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <MagnifyingGlass size={20} color={theme.colors.textMuted} weight="bold" />
          <View style={{ flex: 1 }}>
            <SearchField
              value={query}
              onChangeText={setQuery}
              placeholder="Search journals by text, date, or media name"
              autoCapitalize="none"
              autoFocus
            />
          </View>
        </View>
      </SurfaceCard>

      <SectionHeader
        title="Results"
        subtitle={query.trim() ? `${results.length} match(es)` : 'Type to search local journal and media content'}
      />

      {!query.trim() ? (
        <EmptyState
          title="Search your local library"
          message="The first mobile search pass stays local to synced entries, local summaries, dates, and available media filenames."
        />
      ) : results.length ? (
        <ScrollView contentContainerStyle={{ gap: theme.spacing.sm }}>
          {results.map((result) => (
            <Pressable key={result.key} onPress={() => navigation.navigate('JournalEditor', { isoDate: result.isoDate })}>
              <SurfaceCard>
                <View style={{ gap: theme.spacing.sm }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.md }}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '700' }}>{result.title}</Text>
                      <Text style={{ color: theme.colors.textMuted }}>{result.isoDate}</Text>
                    </View>
                    <StatusPill label={result.matchSource} tone={result.matchSource === 'media' ? 'blue' : 'amber'} />
                  </View>
                  <Text style={{ color: theme.colors.textMuted, lineHeight: 21 }}>{result.snippet}</Text>
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    {result.hasEntry ? <StatusPill label="entry" tone="green" /> : <StatusPill label="media day" tone="gray" />}
                    {result.mediaCount ? <StatusPill label={`${result.mediaCount} media`} tone="blue" /> : null}
                  </View>
                </View>
              </SurfaceCard>
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <EmptyState title="No matches" message="Try a different date, phrase, or filename fragment." />
      )}
    </ScreenShell>
  );
}
