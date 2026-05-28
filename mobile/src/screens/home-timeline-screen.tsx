import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  SectionList,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type PanResponderInstance,
  type SectionListRenderItemInfo,
  type ViewToken
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { List, MagnifyingGlass, Plus } from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMobileApp } from '../app/mobile-app-provider';
import {
  buildTimelineSectionIndex,
  buildTimelineSections,
  timelineSectionIndexFromProgress,
  type MediaItemView,
  type TimelineListItem,
  type TimelineSectionView
} from '../app/mobile-library';
import { useAppTheme } from '../theme/theme-provider';
import { EmptyState, IconButton, ScreenShell, SectionHeader, SurfaceCard, Topbar } from '../components/primitives';
import { TimelineDayCard } from '../components/timeline-day-card';
import { YearCarousel } from '../components/year-carousel';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'HomeTimeline'>;

const FAST_SCROLL_TOUCH_WIDTH = 38;
const FAST_SCROLL_THUMB_HEIGHT = 56;
const FLOATING_TOOLBAR_ROW_HEIGHT = 56;

export function HomeTimelineScreen({ navigation }: Props) {
  const { theme, fontsLoaded } = useAppTheme();
  const { library, status, syncStats, connection, serverSummary } = useMobileApp();
  const insets = useSafeAreaInsets();
  const [activeYear, setActiveYear] = useState<number | null>(null);
  const [isDraggingFastScroll, setIsDraggingFastScroll] = useState(false);
  const [dragTargetSectionIndex, setDragTargetSectionIndex] = useState(0);
  const [visibleSectionIndex, setVisibleSectionIndex] = useState(0);
  const [trackHeight, setTrackHeight] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const sectionListRef = useRef<SectionList<TimelineListItem, TimelineSectionView>>(null);
  const toolbarTranslateY = useRef(new Animated.Value(0)).current;
  const fastScrollProgress = useRef(new Animated.Value(0)).current;
  const lastScrollY = useRef(0);
  const toolbarHidden = useRef(false);
  const viewportHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  const isDraggingFastScrollRef = useRef(false);
  const lastDraggedSectionIndexRef = useRef(-1);
  const pendingScrollSectionIndexRef = useRef<number | null>(null);
  const sections = useMemo(() => buildTimelineSections(library, { year: activeYear }), [library, activeYear]);
  const sectionIndex = useMemo(() => buildTimelineSectionIndex(sections), [sections]);
  const sectionKeyToIndex = useMemo(
    () => new Map(sectionIndex.map((item) => [item.sectionKey, item.sectionIndex])),
    [sectionIndex]
  );
  const sectionKeyToIndexRef = useRef(sectionKeyToIndex);
  const availableYears = library.yearSummaries.map((item) => item.year);
  const floatingToolbarTotalHeight = insets.top + FLOATING_TOOLBAR_ROW_HEIGHT;
  const serverEntryCount = serverSummary?.entries || 0;
  const serverWordCount = serverSummary?.words || 0;
  const syncedMediaCount = serverSummary?.syncedMedia || 0;
  const sectionPaddingX = theme.spacing.md;
  const fastScrollTopInset = floatingToolbarTotalHeight + theme.spacing.lg;
  const fastScrollBottomInset = Math.max(insets.bottom, theme.spacing.md) + theme.spacing.lg;
  const isFastScrollVisible = sectionIndex.length > 1 && contentHeight > viewportHeight + theme.spacing.xl;
  const thumbTravel = Math.max(trackHeight - FAST_SCROLL_THUMB_HEIGHT, 0);

  isDraggingFastScrollRef.current = isDraggingFastScroll;
  sectionKeyToIndexRef.current = sectionKeyToIndex;

  useEffect(() => {
    if (isDraggingFastScroll) return;
    if (sectionIndex.length <= 1) {
      fastScrollProgress.setValue(0);
      return;
    }
    fastScrollProgress.setValue(visibleSectionIndex / (sectionIndex.length - 1));
  }, [fastScrollProgress, isDraggingFastScroll, sectionIndex.length, visibleSectionIndex]);

  useEffect(() => {
    const nextIndex = Math.min(visibleSectionIndex, Math.max(sectionIndex.length - 1, 0));
    if (nextIndex !== visibleSectionIndex) setVisibleSectionIndex(nextIndex);
    const nextDragIndex = Math.min(dragTargetSectionIndex, Math.max(sectionIndex.length - 1, 0));
    if (nextDragIndex !== dragTargetSectionIndex) setDragTargetSectionIndex(nextDragIndex);
  }, [dragTargetSectionIndex, sectionIndex.length, visibleSectionIndex]);

  const updateToolbarVisibility = useCallback((currentY: number) => {
    const deltaY = currentY - lastScrollY.current;
    const movingDown = deltaY > 8;
    const movingUp = deltaY < -8;

    if (currentY <= 12 && toolbarHidden.current) {
      toolbarHidden.current = false;
      Animated.timing(toolbarTranslateY, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true
      }).start();
    } else if (movingDown && currentY > 80 && !toolbarHidden.current) {
      toolbarHidden.current = true;
      Animated.timing(toolbarTranslateY, {
        toValue: -(FLOATING_TOOLBAR_ROW_HEIGHT + theme.spacing.lg),
        duration: 180,
        useNativeDriver: true
      }).start();
    } else if (movingUp && toolbarHidden.current) {
      toolbarHidden.current = false;
      Animated.timing(toolbarTranslateY, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true
      }).start();
    }

    lastScrollY.current = currentY;
  }, [theme.spacing.lg, toolbarTranslateY]);

  const handlePressDay = useCallback((day: TimelineListItem) => {
    navigation.navigate('JournalEditor', { isoDate: day.isoDate });
  }, [navigation]);

  const handleOpenMedia = useCallback((day: TimelineListItem, media: MediaItemView) => {
    navigation.navigate('MediaViewer', { initialItemKey: media.key, isoDate: day.isoDate });
  }, [navigation]);

  const scrollToSection = useCallback((targetSectionIndex: number, animated: boolean) => {
    if (!sectionIndex.length) return;
    const clampedIndex = Math.max(0, Math.min(sectionIndex.length - 1, targetSectionIndex));
    pendingScrollSectionIndexRef.current = clampedIndex;
    sectionListRef.current?.scrollToLocation({
      sectionIndex: clampedIndex,
      itemIndex: 0,
      viewOffset: floatingToolbarTotalHeight + theme.spacing.sm,
      animated
    });
  }, [floatingToolbarTotalHeight, sectionIndex.length, theme.spacing.sm]);

  const handleScrollToLocationFailed = useCallback((info: {
    index: number;
    highestMeasuredFrameIndex: number;
    averageItemLength: number;
  }) => {
    const approximateOffset = Math.max(
      0,
      info.averageItemLength * Math.max(info.index - 1, 0) - floatingToolbarTotalHeight
    );

    const responder = sectionListRef.current?.getScrollResponder?.();
    responder?.scrollTo?.({
      x: 0,
      y: approximateOffset,
      animated: false
    });

    const pendingSectionIndex = pendingScrollSectionIndexRef.current;
    if (pendingSectionIndex === null) return;

    setTimeout(() => {
      sectionListRef.current?.scrollToLocation({
        sectionIndex: pendingSectionIndex,
        itemIndex: 0,
        viewOffset: floatingToolbarTotalHeight + theme.spacing.sm,
        animated: false
      });
    }, 48);
  }, [floatingToolbarTotalHeight, theme.spacing.sm]);

  const updateFastScrollTargetFromLocation = useCallback((locationY: number) => {
    if (!trackHeight || !sectionIndex.length) return;
    const normalized = thumbTravel > 0
      ? Math.max(0, Math.min(1, (locationY - FAST_SCROLL_THUMB_HEIGHT / 2) / thumbTravel))
      : 0;
    fastScrollProgress.setValue(normalized);
    const targetSectionIndex = timelineSectionIndexFromProgress(sectionIndex, normalized);
    setDragTargetSectionIndex(targetSectionIndex);
    if (lastDraggedSectionIndexRef.current !== targetSectionIndex) {
      lastDraggedSectionIndexRef.current = targetSectionIndex;
      setVisibleSectionIndex(targetSectionIndex);
      scrollToSection(targetSectionIndex, false);
    }
  }, [fastScrollProgress, scrollToSection, sectionIndex, thumbTravel, trackHeight]);

  const fastScrollResponder = useMemo<PanResponderInstance>(() => PanResponder.create({
    onStartShouldSetPanResponder: () => isFastScrollVisible,
    onMoveShouldSetPanResponder: () => isFastScrollVisible,
    onPanResponderGrant: (event) => {
      setIsDraggingFastScroll(true);
      updateFastScrollTargetFromLocation(event.nativeEvent.locationY);
    },
    onPanResponderMove: (event) => {
      updateFastScrollTargetFromLocation(event.nativeEvent.locationY);
    },
    onPanResponderTerminationRequest: () => true,
    onPanResponderRelease: () => {
      setIsDraggingFastScroll(false);
      lastDraggedSectionIndexRef.current = -1;
    },
    onPanResponderTerminate: () => {
      setIsDraggingFastScroll(false);
      lastDraggedSectionIndexRef.current = -1;
    }
  }), [fastScrollProgress, isFastScrollVisible, sectionIndex, updateFastScrollTargetFromLocation]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const currentY = event.nativeEvent.contentOffset.y;
    updateToolbarVisibility(currentY);

    if (!isDraggingFastScrollRef.current) {
      const maxOffset = Math.max(contentHeightRef.current - viewportHeightRef.current, 1);
      const progress = Math.max(0, Math.min(1, currentY / maxOffset));
      fastScrollProgress.setValue(progress);
    }
  }, [fastScrollProgress, updateToolbarVisibility]);

  const handleListLayout = useCallback((height: number) => {
    viewportHeightRef.current = height;
    setViewportHeight(height);
  }, []);

  const handleContentSizeChange = useCallback((height: number) => {
    contentHeightRef.current = height;
    setContentHeight(height);
  }, []);

  const handleTrackLayout = useCallback((height: number) => {
    setTrackHeight(height);
  }, []);

  const handleVisibleItemsChanged = useRef(({ viewableItems }: { viewableItems: Array<ViewToken & { section?: TimelineSectionView }> }) => {
    if (isDraggingFastScrollRef.current) return;
    const firstVisibleItem = viewableItems.find((item) => item.index !== null && item.index !== undefined && item.section?.key);
    const sectionKey = firstVisibleItem?.section?.key;
    if (!sectionKey) return;
    const nextSectionIndex = sectionKeyToIndexRef.current.get(sectionKey) ?? 0;
    setVisibleSectionIndex((current) => (current === nextSectionIndex ? current : nextSectionIndex));
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 40,
    minimumViewTime: 32
  }).current;

  const listHeader = useMemo(() => (
    <View style={{ gap: theme.spacing.md, paddingBottom: theme.spacing.md, paddingHorizontal: sectionPaddingX }}>
      <View style={{ gap: theme.spacing.sm, paddingTop: theme.spacing.sm }}>
        <Text
          style={{
            color: theme.colors.textMuted,
            fontSize: fontsLoaded ? 58 : theme.typography.brandTitle,
            lineHeight: fontsLoaded ? 74 : 44,
            textAlign: 'center',
            fontFamily: fontsLoaded ? 'LavishlyYours_400Regular' : undefined,
            paddingBottom: fontsLoaded ? 6 : 0
          }}
        >
          Book of Life
        </Text>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            columnGap: theme.spacing.sm
          }}
        >
          <StatText label="Entries" value={serverEntryCount} />
          <Text style={{ color: theme.colors.textMuted }}>|</Text>
          <StatText label="Words" value={serverWordCount} />
          <Text style={{ color: theme.colors.textMuted }}>|</Text>
          <StatText label="Synced Media" value={syncedMediaCount} />
        </View>
      </View>

      <SectionHeader
        title="Years"
        subtitle="Browse the timeline the way the website does."
        actionLabel="Explorer"
        onActionPress={() => navigation.navigate('Explorer')}
      />
      <YearCarousel
        years={availableYears}
        activeYear={activeYear}
        onSelectYear={(year) => {
          setActiveYear(year);
          if (year !== null) navigation.navigate('Explorer', { year });
        }}
      />

      <SectionHeader
        title="Timeline"
        subtitle={sections.length ? `${sections.reduce((sum, section) => sum + section.data.length, 0)} visible day(s)` : 'No local memories yet'}
      />

      <SurfaceCard accent>
        <Text style={{ color: theme.colors.textMuted, lineHeight: 21 }}>{status}</Text>
        {syncStats ? (
          <Text style={{ color: theme.colors.textMuted, marginTop: 8 }}>
            Pending mutations: {syncStats.pendingMutations} | Local media assets: {syncStats.localMediaAssets}
          </Text>
        ) : null}
        {!connection?.authToken ? (
          <Text style={{ color: theme.colors.textMuted, marginTop: 8 }}>
            Running locally. Open Settings to sign in if you want sync.
          </Text>
        ) : null}
      </SurfaceCard>
    </View>
  ), [
    activeYear,
    availableYears,
    connection?.authToken,
    fontsLoaded,
    navigation,
    sectionPaddingX,
    sections,
    serverEntryCount,
    serverWordCount,
    status,
    syncStats,
    syncedMediaCount,
    theme.colors.textMuted,
    theme.spacing.md,
    theme.spacing.sm,
    theme.typography.brandTitle
  ]);

  const renderSectionHeader = useCallback(({ section }: { section: TimelineSectionView }) => (
    <View style={{ paddingBottom: theme.spacing.sm, paddingHorizontal: sectionPaddingX }}>
      <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '700' }}>{section.title}</Text>
      <Text style={{ color: theme.colors.textMuted }}>{section.subtitle}</Text>
    </View>
  ), [sectionPaddingX, theme.colors.text, theme.colors.textMuted, theme.spacing.sm]);

  const renderTimelineItem = useCallback(({ item }: SectionListRenderItemInfo<TimelineListItem, TimelineSectionView>) => (
    <View style={{ paddingBottom: theme.spacing.sm, paddingHorizontal: sectionPaddingX }}>
      <TimelineDayCard
        day={item}
        onPressDay={handlePressDay}
        onOpenMediaItem={handleOpenMedia}
      />
    </View>
  ), [handleOpenMedia, handlePressDay, sectionPaddingX, theme.spacing.sm]);

  const keyExtractor = useCallback((item: TimelineListItem) => item.isoDate, []);

  const handleOpenSearch = useCallback(() => {
    navigation.navigate('Search');
  }, [navigation]);

  const handleOpenToday = useCallback(() => {
    navigation.navigate('JournalEditor', { isoDate: new Date().toISOString().slice(0, 10) });
  }, [navigation]);

  const currentFastScrollLabel = sectionIndex[
    isDraggingFastScroll ? dragTargetSectionIndex : visibleSectionIndex
  ]?.label;

  return (
    <ScreenShell padded={false}>
      <View style={{ flex: 1 }}>
        <Animated.View
          style={{
            position: 'absolute',
            top: insets.top,
            left: 0,
            right: 0,
            zIndex: 20,
            paddingHorizontal: sectionPaddingX,
            transform: [{ translateY: toolbarTranslateY }]
          }}
        >
          <Topbar
            flat
            lead={<IconButton icon={List} label="Menu" onPress={() => navigation.navigate('Settings')} />}
            actions={(
              <>
                <IconButton icon={MagnifyingGlass} label="Search" onPress={handleOpenSearch} />
                <IconButton icon={Plus} label="Open today" onPress={handleOpenToday} />
              </>
            )}
          />
        </Animated.View>

        <SectionList
          ref={sectionListRef}
          sections={sections}
          keyExtractor={keyExtractor}
          renderItem={renderTimelineItem}
          renderSectionHeader={renderSectionHeader}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={(
            <EmptyState
              title="No timeline yet"
              message="Sign in from Settings or scan a device folder to start building the mobile timeline."
            />
          )}
          contentContainerStyle={{
            gap: theme.spacing.md,
            paddingTop: floatingToolbarTotalHeight + theme.spacing.sm,
            paddingBottom: 32
          }}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          scrollEventThrottle={16}
          initialNumToRender={8}
          maxToRenderPerBatch={6}
          updateCellsBatchingPeriod={32}
          windowSize={7}
          removeClippedSubviews
          onLayout={(event) => handleListLayout(event.nativeEvent.layout.height)}
          onContentSizeChange={(_, height) => handleContentSizeChange(height)}
          onScroll={handleScroll}
          onScrollToIndexFailed={handleScrollToLocationFailed}
          onViewableItemsChanged={handleVisibleItemsChanged}
          viewabilityConfig={viewabilityConfig}
        />

        {isFastScrollVisible ? (
          <View
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              top: fastScrollTopInset,
              right: 0,
              bottom: fastScrollBottomInset,
              width: 92,
              zIndex: 15,
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {isDraggingFastScroll && currentFastScrollLabel ? (
              <View
                style={{
                  position: 'absolute',
                  right: FAST_SCROLL_TOUCH_WIDTH + theme.spacing.sm,
                  top: 0,
                  transform: [{ translateY: thumbTravel ? (dragTargetSectionIndex / Math.max(sectionIndex.length - 1, 1)) * thumbTravel : 0 }],
                  backgroundColor: theme.colors.surface,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.md,
                  paddingHorizontal: 12,
                  paddingVertical: 8
                }}
              >
                <Text style={{ color: theme.colors.text, fontWeight: '700' }}>{currentFastScrollLabel}</Text>
              </View>
            ) : null}

            <View
              {...fastScrollResponder.panHandlers}
              onLayout={(event) => handleTrackLayout(event.nativeEvent.layout.height)}
              style={{
                width: FAST_SCROLL_TOUCH_WIDTH,
                alignItems: 'center',
                justifyContent: 'center',
                flex: 1
              }}
            >
              <View
                style={{
                  width: 4,
                  height: '100%',
                  borderRadius: theme.radius.pill,
                  backgroundColor: theme.colors.border,
                  opacity: isDraggingFastScroll ? 0.55 : 0.25
                }}
              />
              <Animated.View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  height: FAST_SCROLL_THUMB_HEIGHT,
                  alignItems: 'center',
                  justifyContent: 'center',
                  transform: [{ translateY: Animated.multiply(fastScrollProgress, thumbTravel) }]
                }}
              >
                <View
                  style={{
                    width: 22,
                    height: FAST_SCROLL_THUMB_HEIGHT,
                    borderRadius: theme.radius.pill,
                    backgroundColor: theme.colors.text,
                    opacity: isDraggingFastScroll ? 0.92 : 0.42
                  }}
                />
              </Animated.View>
            </View>
          </View>
        ) : null}
      </View>
    </ScreenShell>
  );

  function StatText({ label, value }: { label: string; value: number }) {
    return (
      <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
        <Text style={{ color: theme.colors.text, fontSize: 20, fontWeight: '700' }}>{value.toLocaleString()}</Text>
        <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.meta, textTransform: 'uppercase' }}>{label}</Text>
      </View>
    );
  }
}
