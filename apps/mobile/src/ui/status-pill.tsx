import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

const TONE_MAP = {
  blue: { backgroundColor: '#dcecff', color: '#1a5275' },
  green: { backgroundColor: '#dff5e6', color: '#215b39' },
  amber: { backgroundColor: '#fff0cf', color: '#7a5813' },
  gray: { backgroundColor: '#e8e2d8', color: '#5f5546' },
  red: { backgroundColor: '#f9d8d6', color: '#7a2f2a' }
} as const;

export function StatusPill({ label, tone = 'gray' }: { label: string; tone?: keyof typeof TONE_MAP }) {
  const palette = TONE_MAP[tone] || TONE_MAP.gray;
  return (
    <View style={[styles.pill, { backgroundColor: palette.backgroundColor }]}>
      <Text style={[styles.text, { color: palette.color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start'
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase'
  }
});
