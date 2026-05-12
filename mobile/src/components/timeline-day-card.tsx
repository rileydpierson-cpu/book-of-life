import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { MediaItemView, TimelineDayView } from '../app/mobile-library';
import { StatusPill } from '../ui/status-pill';

function journalTone(status: TimelineDayView['journalStatus']) {
  if (status === 'synced') return 'green';
  if (status === 'pending') return 'amber';
  return 'gray';
}

function previewSource(item: MediaItemView) {
  if (item.cachePath) return { uri: item.cachePath };
  if (item.assetUri) return { uri: item.assetUri };
  return null;
}

export function TimelineDayCard(props: {
  day: TimelineDayView;
  mediaItems: MediaItemView[];
  active: boolean;
  onPress: () => void;
  onOpenMedia: (item: MediaItemView) => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.card, props.active ? styles.cardActive : null]}
      onPress={props.onPress}
      activeOpacity={0.92}
    >
      <View style={styles.headerRow}>
        <View style={styles.titleBlock}>
          <Text style={styles.dateText}>{props.day.isoDate}</Text>
          <Text style={styles.summaryText}>{props.day.summary}</Text>
        </View>
        <StatusPill label={props.day.journalStatus} tone={journalTone(props.day.journalStatus)} />
      </View>

      <View style={styles.badgeRow}>
        <StatusPill label={`${props.day.syncedMediaCount} synced`} tone="green" />
        {props.day.remoteOnlyMediaCount ? <StatusPill label={`${props.day.remoteOnlyMediaCount} remote`} tone="blue" /> : null}
        {props.day.localMediaCount ? <StatusPill label={`${props.day.localMediaCount} local`} tone="gray" /> : null}
      </View>

      {props.mediaItems.length ? (
        <View style={styles.previewRow}>
          {props.mediaItems.slice(0, 4).map((item) => {
            const source = previewSource(item);
            return (
              <TouchableOpacity
                key={item.key}
                style={styles.previewTile}
                onPress={() => props.onOpenMedia(item)}
                activeOpacity={0.88}
              >
                {source ? (
                  <Image source={source} style={styles.previewImage} resizeMode="cover" />
                ) : (
                  <View style={styles.previewFallback}>
                    <Text style={styles.previewFallbackText}>{item.sourceStatus.toUpperCase()}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fffaf0',
    borderRadius: 22,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#e0d6c2'
  },
  cardActive: {
    borderColor: '#2f5f87',
    backgroundColor: '#f3f8fc'
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12
  },
  titleBlock: {
    flex: 1,
    gap: 6
  },
  dateText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2a281f'
  },
  summaryText: {
    fontSize: 14,
    color: '#5b5447',
    lineHeight: 20
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap'
  },
  previewRow: {
    flexDirection: 'row',
    gap: 10
  },
  previewTile: {
    width: 72,
    height: 72,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#e8dfcf'
  },
  previewImage: {
    width: '100%',
    height: '100%'
  },
  previewFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8dfcf'
  },
  previewFallbackText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#5f5546'
  }
});
