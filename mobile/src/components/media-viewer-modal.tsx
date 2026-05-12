import React from 'react';
import { Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { MediaItemView } from '../app/mobile-library';
import { StatusPill } from '../ui/status-pill';

function mediaTone(status: MediaItemView['sourceStatus'], syncState: string) {
  if (syncState === 'upload-failed') return 'red';
  if (syncState === 'upload-pending') return 'amber';
  if (status === 'synced') return 'green';
  if (status === 'remote') return 'blue';
  return 'gray';
}

function previewSource(item: MediaItemView | null) {
  if (!item) return null;
  if (item.cachePath) return { uri: item.cachePath };
  if (item.assetUri) return { uri: item.assetUri };
  return null;
}

export function MediaViewerModal(props: {
  visible: boolean;
  item: MediaItemView | null;
  canGoPrev: boolean;
  canGoNext: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onCacheThumb: () => void;
  onCachePrimary: () => void;
}) {
  const source = previewSource(props.item);
  const mediaType = props.item?.mediaType || 'media';
  return (
    <Modal visible={props.visible} animationType="fade" presentationStyle="fullScreen" onRequestClose={props.onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.fileName}>{props.item?.fileName || 'Media'}</Text>
            <Text style={styles.metaText}>{props.item?.isoDate || 'No date'} | {mediaType}</Text>
          </View>
          {props.item ? <StatusPill label={props.item.sourceStatus} tone={mediaTone(props.item.sourceStatus, props.item.syncState)} /> : null}
        </View>

        <View style={styles.viewerStage}>
          {source ? (
            <Image source={source} style={styles.viewerImage} resizeMode="contain" />
          ) : (
            <View style={styles.viewerPlaceholder}>
              <Text style={styles.placeholderTitle}>Remote media not cached yet</Text>
              <Text style={styles.placeholderText}>Cache a thumb or full file to view it locally.</Text>
            </View>
          )}
        </View>

        <ScrollView contentContainerStyle={styles.details}>
          <View style={styles.pillRow}>
            {props.item ? <StatusPill label={props.item.syncState || 'unknown'} tone={mediaTone(props.item.sourceStatus, props.item.syncState)} /> : null}
            {props.item?.cachePath ? <StatusPill label="cached" tone="blue" /> : null}
          </View>

          <View style={styles.buttonRow}>
            <TouchableOpacity style={[styles.button, !props.canGoPrev ? styles.buttonDisabled : null]} onPress={props.onPrev} disabled={!props.canGoPrev}>
              <Text style={styles.buttonText}>Previous</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, !props.canGoNext ? styles.buttonDisabled : null]} onPress={props.onNext} disabled={!props.canGoNext}>
              <Text style={styles.buttonText}>Next</Text>
            </TouchableOpacity>
          </View>

          {props.item?.sourceStatus !== 'local' ? (
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.button} onPress={props.onCacheThumb}>
                <Text style={styles.buttonText}>Cache Thumb</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.button} onPress={props.onCachePrimary}>
                <Text style={styles.buttonText}>{mediaType === 'video' ? 'Cache Preview' : 'Cache Full'}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <TouchableOpacity style={[styles.button, styles.closeButton]} onPress={props.onClose}>
            <Text style={styles.buttonText}>Close Viewer</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#16140f'
  },
  header: {
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12
  },
  headerCopy: {
    flex: 1,
    gap: 6
  },
  fileName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#f6f0e5'
  },
  metaText: {
    fontSize: 14,
    color: '#d8cfc2'
  },
  viewerStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16
  },
  viewerImage: {
    width: '100%',
    height: '100%'
  },
  viewerPlaceholder: {
    width: '100%',
    borderRadius: 20,
    padding: 24,
    backgroundColor: '#24201a',
    gap: 10
  },
  placeholderTitle: {
    color: '#f6f0e5',
    fontSize: 20,
    fontWeight: '700'
  },
  placeholderText: {
    color: '#d8cfc2',
    fontSize: 14,
    lineHeight: 20
  },
  details: {
    padding: 20,
    gap: 12
  },
  pillRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap'
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10
  },
  button: {
    flex: 1,
    backgroundColor: '#2f5f87',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center'
  },
  closeButton: {
    marginTop: 4
  },
  buttonDisabled: {
    backgroundColor: '#4a5560'
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '700'
  }
});
