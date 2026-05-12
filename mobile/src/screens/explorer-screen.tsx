import React, { useCallback, useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ArrowLeft } from 'phosphor-react-native';
import { useMobileApp } from '../app/mobile-app-provider';
import { buildTimelineSections, type MediaItemView, type TimelineListItem } from '../app/mobile-library';
import { useAppTheme } from '../theme/theme-provider';
import { EmptyState, IconButton, ScreenShell, SectionHeader, SurfaceCard, Topbar } from '../components/primitives';
import { TimelineDayCard } from '../components/timeline-day-card';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Explorer'>;

export function ExplorerScreen({ navigation, route }: Props) {
  const { theme } = useAppTheme();
  const { library } = useMobileApp();
  const year = route.params?.year ?? null;
  const monthKey = route.params?.monthKey ?? null;
  const yearSummary = year !== null ? library.yearSummaries.find((item) => item.year === year) : null;
  const monthSummary = monthKey ? library.monthSummaries.find((item) => item.monthKey === monthKey) : null;
  const monthSection = useMemo(() => buildTimelineSections(library, { year }), [library, year]);
  const handlePressDay = useCallback((day: TimelineListItem) => {
    navigation.navigate('JournalEditor', { isoDate: day.isoDate });
  }, [navigation]);
  const handleOpenMedia = useCallback((day: TimelineListItem, media: MediaItemView) => {
    navigation.navigate('MediaViewer', { initialItemKey: media.key, isoDate: day.isoDate });
  }, [navigation]);

  let content: React.ReactNode;

  if (year === null) {
    content = library.yearSummaries.length ? (
      <View style={{ gap: theme.spacing.sm }}>
        {library.yearSummaries.map((item) => (
          <Pressable key={item.year} onPress={() => navigation.push('Explorer', { year: item.year })}>
            <SurfaceCard>
              <View style={{ gap: 8 }}>
                <Text style={{ color: theme.colors.text, fontSize: 20, fontWeight: '700' }}>{item.label}</Text>
                <Text style={{ color: theme.colors.textMuted }}>{item.dayCount} active days • {item.mediaCount} media items</Text>
              </View>
            </SurfaceCard>
          </Pressable>
        ))}
      </View>
    ) : <EmptyState title="No explorer data yet" message="The explorer fills in as local entries and synced media arrive." />;
  } else if (year !== null && !monthKey) {
    content = yearSummary ? (
      <View style={{ gap: theme.spacing.sm }}>
        {yearSummary.months.map((item) => (
          <Pressable key={item.monthKey} onPress={() => navigation.push('Explorer', { year, monthKey: item.monthKey })}>
            <SurfaceCard accent>
              <View style={{ gap: 8 }}>
                <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '700' }}>{item.label}</Text>
                <Text style={{ color: theme.colors.textMuted }}>{item.dayCount} active days • {item.mediaCount} media items</Text>
              </View>
            </SurfaceCard>
          </Pressable>
        ))}
      </View>
    ) : <EmptyState title="Missing year" message="That year does not exist in the current mobile library snapshot." />;
  } else {
    const section = monthSection.find((item) => item.key === monthKey);
    content = section ? (
      <View style={{ gap: theme.spacing.sm }}>
        {section.data.map((item) => (
          <TimelineDayCard
            key={item.isoDate}
            day={item}
            onPressDay={handlePressDay}
            onOpenMediaItem={handleOpenMedia}
          />
        ))}
      </View>
    ) : <EmptyState title="No month data" message="That month is not available in the current snapshot." />;
  }

  return (
    <ScreenShell scroll contentContainerStyle={{ gap: theme.spacing.md }}>
      <Topbar
        title={monthSummary?.label || yearSummary?.label || 'Explorer'}
        subtitle={monthKey ? 'Month drill-down' : (year !== null ? 'Year overview' : 'Browse your archive')}
        lead={<IconButton icon={ArrowLeft} label="Back" onPress={() => navigation.goBack()} />}
      />
      <SectionHeader
        title={monthKey ? 'Days' : (year !== null ? 'Months' : 'Years')}
        subtitle={monthKey ? `Open a day to edit or view media` : `Follow the same hierarchy used in the web app`}
      />
      {content}
    </ScreenShell>
  );
}
