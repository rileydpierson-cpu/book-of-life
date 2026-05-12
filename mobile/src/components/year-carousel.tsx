import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export function YearCarousel(props: {
  years: number[];
  activeYear: number | null;
  onSelectYear: (year: number | null) => void;
}) {
  return (
    <View style={styles.shell}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        <TouchableOpacity
          style={[styles.chip, props.activeYear === null ? styles.chipActive : null]}
          onPress={() => props.onSelectYear(null)}
        >
          <Text style={[styles.chipText, props.activeYear === null ? styles.chipTextActive : null]}>All</Text>
        </TouchableOpacity>
        {props.years.map((year) => (
          <TouchableOpacity
            key={year}
            style={[styles.chip, props.activeYear === year ? styles.chipActive : null]}
            onPress={() => props.onSelectYear(year)}
          >
            <Text style={[styles.chipText, props.activeYear === year ? styles.chipTextActive : null]}>{year}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    marginTop: 4
  },
  row: {
    gap: 12,
    paddingHorizontal: 2
  },
  chip: {
    minWidth: 90,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(255,252,247,0.86)',
    borderWidth: 1,
    borderColor: 'rgba(65,47,28,0.08)',
    alignItems: 'center'
  },
  chipActive: {
    backgroundColor: '#7d5f43',
    borderColor: '#7d5f43'
  },
  chipText: {
    color: '#1f1a16',
    fontWeight: '700'
  },
  chipTextActive: {
    color: '#fffdfa'
  }
});
