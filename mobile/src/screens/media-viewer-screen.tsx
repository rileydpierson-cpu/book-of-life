import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ArrowLeft, DownloadSimple } from 'phosphor-react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { buildViewerSequence, type ViewerItemView } from '../app/mobile-library';
import { useMobileApp } from '../app/mobile-app-provider';
import { useAppTheme } from '../theme/theme-provider';
import { EmptyState, IconButton, PrimaryButton, ScreenShell, SecondaryButton, StatusPill, SurfaceCard, Topbar } from '../components/primitives';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'MediaViewer'>;

function sourceTone(item: ViewerItemView) {
  if (item.syncState === 'upload-failed') return 'red' as const;
  if (item.syncState === 'upload-pending') return 'amber' as const;
  if (item.sourceStatus === 'synced') return 'green' as const;
  if (item.sourceStatus === 'remote') return 'blue' as const;
  return 'gray' as const;
}

function Slide(props: { item: ViewerItemView; width: number }) {
  const { theme } = useAppTheme();
  const source = props.item.cachePath || props.item.assetUri;
  const isVideo = props.item.mediaType === 'video';
  const player = useVideoPlayer(source ? { uri: source } : null, (nextPlayer) => {
    nextPlayer.loop = false;
  });

  if (!source) {
    return (
      <View style={{ width: props.width, paddingHorizontal: theme.spacing.md, justifyContent: 'center' }}>
        <SurfaceCard accent style={{ minHeight: 300, justifyContent: 'center' }}>
          <Text style={{ color: theme.colors.text, fontSize: 22, fontWeight: '700' }}>Remote media not cached yet</Text>
          <Text style={{ color: theme.colors.textMuted, marginTop: 8, lineHeight: 22 }}>
            Cache a thumb or primary file to make this memory available on-device.
          </Text>
        </SurfaceCard>
      </View>
    );
  }

  return (
    <View style={{ width: props.width, paddingHorizontal: theme.spacing.md, justifyContent: 'center' }}>
      <View
        style={{
          borderRadius: theme.radius.lg,
          overflow: 'hidden',
          backgroundColor: '#0f0d0a',
          minHeight: 340,
          justifyContent: 'center'
        }}
      >
        {isVideo ? (
          <VideoView
            player={player}
            style={{ width: '100%', aspectRatio: 1 }}
            nativeControls
            contentFit="contain"
          />
        ) : (
          <Image source={{ uri: source }} style={{ width: '100%', aspectRatio: 1 }} resizeMode="contain" />
        )}
      </View>
    </View>
  );
}

export function MediaViewerScreen({ navigation, route }: Props) {
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const { library, cacheMediaVariant } = useMobileApp();
  const items = useMemo(() => buildViewerSequence({ snapshot: library, isoDate: route.params.isoDate }), [library, route.params.isoDate]);
  const initialIndex = Math.max(0, items.findIndex((item) => item.key === route.params.initialItemKey));
  const [viewerIndex, setViewerIndex] = useState(initialIndex);
  const listRef = useRef<FlatList<ViewerItemView>>(null);
  const activeItem = items[viewerIndex] || null;

  useEffect(() => {
    setViewerIndex(initialIndex);
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index: initialIndex, animated: false });
    });
  }, [route.params.initialItemKey, route.params.isoDate, initialIndex]);

  if (!items.length || !activeItem) {
    return (
      <ScreenShell scroll>
        <Topbar
          title="Viewer"
          subtitle="No media available"
          lead={<IconButton icon={ArrowLeft} label="Back" onPress={() => navigation.goBack()} />}
        />
        <EmptyState title="No media found" message="This day does not currently have any media to display." />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell>
      <View style={{ flex: 1, gap: theme.spacing.md }}>
        <Topbar
          title={activeItem.fileName}
          subtitle={activeItem.subtitle}
          lead={<IconButton icon={ArrowLeft} label="Back" onPress={() => navigation.goBack()} />}
          actions={<StatusPill label={activeItem.sourceStatus} tone={sourceTone(activeItem)} />}
        />

        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(item) => item.key}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
          onMomentumScrollEnd={(event) => {
            const nextIndex = Math.round(event.nativeEvent.contentOffset.x / width);
            setViewerIndex(Math.max(0, Math.min(items.length - 1, nextIndex)));
          }}
          renderItem={({ item }) => <Slide item={item} width={width} />}
        />

        <SurfaceCard>
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap', marginBottom: theme.spacing.sm }}>
            <StatusPill label={activeItem.syncState || 'unknown'} tone={sourceTone(activeItem)} />
            {activeItem.cachePath ? <StatusPill label="cached" tone="blue" /> : null}
            <StatusPill label={`${viewerIndex + 1}/${items.length}`} tone="gray" />
          </View>

          <View style={{ gap: 6 }}>
            <Text style={{ color: theme.colors.text, fontSize: 20, fontWeight: '700' }}>{activeItem.fileName}</Text>
            <Text style={{ color: theme.colors.textMuted }}>{activeItem.isoDate || 'No date'} • {activeItem.mediaType}</Text>
            <Text style={{ color: theme.colors.textMuted }}>{activeItem.dimensionsLabel} • {activeItem.sizeLabel}</Text>
            {activeItem.folderLabel ? <Text style={{ color: theme.colors.textMuted }}>Folder: {activeItem.folderLabel}</Text> : null}
          </View>

          <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
            <SecondaryButton
              label="Previous"
              onPress={() => scrollToIndex(Math.max(0, viewerIndex - 1))}
              disabled={viewerIndex <= 0}
              fullWidth
            />
            <SecondaryButton
              label="Next"
              onPress={() => scrollToIndex(Math.min(items.length - 1, viewerIndex + 1))}
              disabled={viewerIndex >= items.length - 1}
              fullWidth
            />
          </View>

          {activeItem.sourceStatus !== 'local' ? (
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
              <SecondaryButton
                label="Cache Thumb"
                icon={<DownloadSimple size={18} color={theme.colors.text} weight="bold" />}
                onPress={() => cacheMediaVariant({
                  photoId: activeItem.remoteMediaId,
                  fileName: activeItem.fileName,
                  variant: 'thumb'
                })}
                fullWidth
              />
              <PrimaryButton
                label={activeItem.mediaType === 'video' ? 'Cache Preview' : 'Cache Full'}
                onPress={() => cacheMediaVariant({
                  photoId: activeItem.remoteMediaId,
                  fileName: activeItem.fileName,
                  variant: activeItem.mediaType === 'video' ? 'preview' : 'full'
                })}
                fullWidth
              />
            </View>
          ) : null}

          <Pressable onPress={() => navigation.goBack()} style={{ marginTop: theme.spacing.md }}>
            <Text style={{ color: theme.colors.accent, fontWeight: '700', textAlign: 'center' }}>Close Viewer</Text>
          </Pressable>
        </SurfaceCard>
      </View>
    </ScreenShell>
  );

  function scrollToIndex(index: number) {
    listRef.current?.scrollToIndex({ index, animated: true });
    setViewerIndex(index);
  }
}
