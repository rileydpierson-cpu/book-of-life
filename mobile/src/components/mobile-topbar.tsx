import React from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { StatusPill } from '../ui/status-pill';

export function MobileTopbar(props: {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onHomePress: () => void;
  onDatePress: () => void;
  onSettingsPress: () => void;
  syncEnabled: boolean;
  pendingCount: number;
  dateLabel: string;
}) {
  return (
    <View style={styles.shell}>
      <View style={styles.headerRow}>
        <View style={styles.brandCluster}>
          <TouchableOpacity style={styles.brandButton} onPress={props.onHomePress}>
            <Text style={styles.brandMark}>LS</Text>
          </TouchableOpacity>
          <View style={styles.brandBlock}>
            <TouchableOpacity onPress={props.onDatePress}>
              <Text style={styles.dateLabel}>{props.dateLabel}</Text>
            </TouchableOpacity>
            <Text style={styles.brandSubtitle}>Memory browser</Text>
          </View>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.iconButton} onPress={props.onDatePress}>
            <Text style={styles.iconText}>+</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.profileButton} onPress={props.onSettingsPress}>
            <Text style={styles.profileText}>LS</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.metaRow}>
        <StatusPill label={props.syncEnabled ? 'Sync On' : 'Local Only'} tone={props.syncEnabled ? 'green' : 'gray'} />
        {props.pendingCount ? <StatusPill label={`${props.pendingCount} Pending`} tone="amber" /> : null}
      </View>
      <TextInput
        style={styles.searchInput}
        value={props.searchQuery}
        onChangeText={props.onSearchChange}
        autoCapitalize="none"
        placeholder="Search journals or dates"
        placeholderTextColor="#7a7366"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: 'rgba(255,252,247,0.9)',
    borderRadius: 24,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(65,47,28,0.08)'
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12
  },
  brandCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1
  },
  brandButton: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: '#fffdfa',
    alignItems: 'center',
    justifyContent: 'center'
  },
  brandMark: {
    color: '#5b432d',
    fontWeight: '700'
  },
  brandBlock: {
    gap: 3,
    flex: 1
  },
  dateLabel: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1f1a16'
  },
  brandSubtitle: {
    fontSize: 13,
    color: '#74685c'
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center'
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#fffdfa',
    alignItems: 'center',
    justifyContent: 'center'
  },
  iconText: {
    color: '#1f1a16',
    fontSize: 20,
    fontWeight: '700'
  },
  profileButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#7d5f43',
    alignItems: 'center',
    justifyContent: 'center'
  },
  profileText: {
    color: '#fffdfa',
    fontWeight: '700'
  },
  metaRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap'
  },
  searchInput: {
    borderWidth: 1,
    borderColor: '#d2c7b2',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#fffdfa',
    fontSize: 15,
    color: '#2f291f'
  }
});
