import React from 'react';
import { ScrollView, Text, View, Pressable } from 'react-native';
import { useAppTheme } from '../theme/theme-provider';

export function YearCarousel(props: {
  years: number[];
  activeYear: number | null;
  onSelectYear: (year: number | null) => void;
}) {
  const { theme } = useAppTheme();
  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.sm, paddingHorizontal: 2 }}>
        <YearChip label="All Years" active={props.activeYear === null} onPress={() => props.onSelectYear(null)} />
        {props.years.map((year) => (
          <YearChip
            key={year}
            label={String(year)}
            active={props.activeYear === year}
            onPress={() => props.onSelectYear(year)}
          />
        ))}
      </ScrollView>
    </View>
  );

  function YearChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({
          minWidth: 104,
          paddingHorizontal: 18,
          paddingVertical: 14,
          borderRadius: theme.radius.lg,
          backgroundColor: active ? theme.colors.accent : theme.colors.surface,
          borderWidth: 1,
          borderColor: active ? theme.colors.accent : theme.colors.border,
          opacity: pressed ? 0.85 : 1,
          alignItems: 'center'
        })}
      >
        <Text style={{ color: active ? theme.colors.onAccent : theme.colors.text, fontWeight: '700' }}>{label}</Text>
      </Pressable>
    );
  }
}
