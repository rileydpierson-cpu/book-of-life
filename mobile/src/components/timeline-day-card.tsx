import React, { memo } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import type { TimelineListItem, MediaItemView } from '../app/mobile-library';
import { useAppTheme } from '../theme/theme-provider';
import { StatusPill, SurfaceCard } from './primitives';

function journalTone(status: TimelineListItem['journalStatus']) {
  if (status === 'synced') return 'green' as const;
  if (status === 'pending') return 'amber' as const;
  return 'gray' as const;
}

function previewSource(item: MediaItemView) {
  if (item.cachePath) return { uri: item.cachePath };
  if (item.assetUri) return { uri: item.assetUri };
  return null;
}

function TimelineDayCardComponent(props: {
  day: TimelineListItem;
  active?: boolean;
  onPressDay: (day: TimelineListItem) => void;
  onOpenMediaItem: (day: TimelineListItem, item: MediaItemView) => void;
}) {
  const { theme } = useAppTheme();
  const previewItems = props.day.mediaItems.slice(0, 4);
  return (
    <Pressable onPress={() => props.onPressDay(props.day)}>
      <SurfaceCard accent={props.active} style={props.active ? { borderColor: theme.colors.accent } : undefined}>
        <View style={{ gap: theme.spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.md }}>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '700' }}>{props.day.title}</Text>
              <Text style={{ color: theme.colors.textMuted, fontSize: 14, lineHeight: 21 }}>{props.day.summary}</Text>
            </View>
            <StatusPill label={props.day.journalStatus} tone={journalTone(props.day.journalStatus)} />
          </View>

          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <StatusPill label={`${props.day.syncedMediaCount} synced`} tone="green" />
            {props.day.remoteOnlyMediaCount ? <StatusPill label={`${props.day.remoteOnlyMediaCount} remote`} tone="blue" /> : null}
            {props.day.localMediaCount ? <StatusPill label={`${props.day.localMediaCount} local`} tone="gray" /> : null}
          </View>

          {previewItems.length ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {previewItems.map((item) => {
                const source = previewSource(item);
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => props.onOpenMediaItem(props.day, item)}
                    style={{
                      width: 76,
                      height: 76,
                      borderRadius: theme.radius.md,
                      overflow: 'hidden',
                      backgroundColor: theme.colors.surfaceMuted
                    }}
                  >
                    {source && item.mediaType !== 'video' ? (
                      <Image source={source} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                    ) : (
                      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 8 }}>
                        <Text style={{ color: theme.colors.textMuted, fontSize: 11, fontWeight: '700', textAlign: 'center' }}>
                          {item.mediaType === 'video' ? 'VIDEO' : item.sourceStatus.toUpperCase()}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
      </SurfaceCard>
    </Pressable>
  );
}

export const TimelineDayCard = memo(TimelineDayCardComponent);
