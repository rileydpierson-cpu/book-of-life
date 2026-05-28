import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle
} from 'react-native';
import { BlurView } from 'expo-blur';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Icon } from 'phosphor-react-native';
import { useAppTheme } from '../theme/theme-provider';

export function ScreenShell(props: {
  children: React.ReactNode;
  scroll?: boolean;
  contentContainerStyle?: ViewStyle;
  padded?: boolean;
}) {
  const { theme } = useAppTheme();
  const padded = props.padded !== false;
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {props.scroll ? (
        <ScrollView
          contentContainerStyle={[
            {
              padding: padded ? theme.spacing.md : 0,
              gap: theme.spacing.md
            },
            props.contentContainerStyle
          ]}
        >
          {props.children}
        </ScrollView>
      ) : (
        <View
          style={[
            {
              flex: 1,
              padding: padded ? theme.spacing.md : 0
            },
            props.contentContainerStyle
          ]}
        >
          {props.children}
        </View>
      )}
    </SafeAreaView>
  );
}

export function SurfaceCard(props: {
  children: React.ReactNode;
  accent?: boolean;
  style?: ViewStyle;
}) {
  const { theme } = useAppTheme();
  return (
    <View
      style={[
        {
          backgroundColor: props.accent ? theme.colors.surfaceAccent : theme.colors.surface,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.colors.border,
          padding: theme.spacing.md,
          shadowColor: theme.colors.shadow,
          shadowOpacity: 1,
          shadowOffset: { width: 0, height: 8 },
          shadowRadius: 18,
          elevation: 2
        },
        props.style
      ]}
    >
      {props.children}
    </View>
  );
}

export function SectionHeader(props: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onActionPress?: () => void;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.md, alignItems: 'flex-end' }}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: theme.colors.text, fontSize: theme.typography.sectionTitle, fontWeight: '700' }}>{props.title}</Text>
        {props.subtitle ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.body }}>{props.subtitle}</Text>
        ) : null}
      </View>
      {props.actionLabel && props.onActionPress ? (
        <Pressable onPress={props.onActionPress}>
          <Text style={{ color: theme.colors.accent, fontSize: theme.typography.caption, fontWeight: '700' }}>{props.actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const TONE_MAP = {
  gray: { background: 'surfaceMuted', border: 'border', text: 'textMuted' },
  green: { background: 'surfaceMuted', border: 'success', text: 'success' },
  amber: { background: 'surfaceMuted', border: 'warning', text: 'warning' },
  blue: { background: 'accentSoft', border: 'info', text: 'info' },
  red: { background: 'surfaceMuted', border: 'destructive', text: 'destructive' }
} as const;

export function StatusPill(props: {
  label: string;
  tone?: keyof typeof TONE_MAP;
}) {
  const { theme } = useAppTheme();
  const tone = TONE_MAP[props.tone || 'gray'];
  return (
    <View
      style={{
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        borderColor: theme.colors[tone.border],
        backgroundColor: theme.colors[tone.background]
      }}
    >
      <Text style={{ color: theme.colors[tone.text], fontSize: theme.typography.meta, fontWeight: '700', textTransform: 'uppercase' }}>
        {props.label}
      </Text>
    </View>
  );
}

function ButtonBase(props: {
  label: string;
  icon?: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  variant: 'primary' | 'secondary';
  fullWidth?: boolean;
}) {
  const { theme } = useAppTheme();
  const primary = props.variant === 'primary';
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      style={({ pressed }) => ({
        opacity: props.disabled ? 0.55 : (pressed ? 0.85 : 1),
        backgroundColor: primary ? theme.colors.accent : theme.colors.surfaceMuted,
        borderWidth: 1,
        borderColor: primary ? theme.colors.accent : theme.colors.border,
        borderRadius: theme.radius.md,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: 14,
        minHeight: 50,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
        alignSelf: props.fullWidth ? 'stretch' : 'flex-start'
      })}
    >
      {props.icon}
      <Text style={{ color: primary ? theme.colors.onAccent : theme.colors.text, fontWeight: '700' }}>{props.label}</Text>
    </Pressable>
  );
}

export function PrimaryButton(props: Omit<Parameters<typeof ButtonBase>[0], 'variant'>) {
  return <ButtonBase {...props} variant="primary" />;
}

export function SecondaryButton(props: Omit<Parameters<typeof ButtonBase>[0], 'variant'>) {
  return <ButtonBase {...props} variant="secondary" />;
}

export function IconButton(props: {
  icon: Icon;
  onPress: () => void;
  label: string;
  filled?: boolean;
}) {
  const { theme } = useAppTheme();
  const IconComponent = props.icon;
  return (
    <Pressable
      accessibilityLabel={props.label}
      onPress={props.onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: props.filled ? theme.colors.accent : theme.colors.border,
        backgroundColor: props.filled ? theme.colors.accent : theme.colors.surface,
        opacity: pressed ? 0.85 : 1,
        alignItems: 'center',
        justifyContent: 'center'
      })}
    >
      <IconComponent size={20} color={props.filled ? theme.colors.onAccent : theme.colors.text} weight="bold" />
    </Pressable>
  );
}

export function Topbar(props: {
  title?: string;
  subtitle?: string;
  lead?: React.ReactNode;
  actions?: React.ReactNode;
  flat?: boolean;
  blur?: boolean;
}) {
  const { theme, themeName } = useAppTheme();
  const hasCopy = Boolean(props.title || props.subtitle);
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
      {props.lead}
      {hasCopy ? (
        <View style={{ flex: 1, gap: 4 }}>
          {props.title ? <Text style={{ color: theme.colors.text, fontSize: 22, fontWeight: '700' }}>{props.title}</Text> : null}
          {props.subtitle ? <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.caption }}>{props.subtitle}</Text> : null}
        </View>
      ) : <View style={{ flex: 1 }} />}
      {props.actions ? <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>{props.actions}</View> : null}
    </View>
  );

  const containerStyle: ViewStyle = {
    backgroundColor: props.blur
      ? 'rgba(255,255,255,0.08)'
      : (props.flat ? 'transparent' : theme.colors.surface),
    borderRadius: props.flat ? 0 : theme.radius.lg,
    borderWidth: props.flat ? 0 : 1,
    borderColor: props.flat ? 'transparent' : theme.colors.border,
    paddingHorizontal: props.flat ? 0 : theme.spacing.md,
    paddingVertical: props.flat ? theme.spacing.xs : theme.spacing.md,
    shadowColor: props.flat ? 'transparent' : theme.colors.shadow,
    shadowOpacity: props.flat ? 0 : 1,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 18,
    elevation: props.flat ? 0 : 2,
    overflow: props.blur ? 'hidden' : 'visible'
  };

  if (props.blur) {
    return (
      <BlurView
        intensity={48}
        tint={themeName === 'dark' ? 'dark' : 'light'}
        experimentalBlurMethod="dimezisBlurView"
        style={containerStyle}
      >
        {content}
      </BlurView>
    );
  }

  return (
    <View style={containerStyle}>
      {content}
    </View>
  );
}

export function SearchField(props: TextInputProps) {
  const { theme } = useAppTheme();
  return (
    <TextInput
      {...props}
      placeholderTextColor={theme.colors.textMuted}
      style={[
        styles.searchInput,
        {
          color: theme.colors.text,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface
        },
        props.style
      ]}
    />
  );
}

export function EmptyState(props: {
  title: string;
  message: string;
}) {
  const { theme } = useAppTheme();
  return (
    <SurfaceCard accent>
      <View style={{ gap: 8 }}>
        <Text style={{ color: theme.colors.text, fontSize: 20, fontWeight: '700' }}>{props.title}</Text>
        <Text style={{ color: theme.colors.textMuted, lineHeight: 22 }}>{props.message}</Text>
      </View>
    </SurfaceCard>
  );
}

export function ThemeChoiceChip(props: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        borderColor: props.active ? theme.colors.accent : theme.colors.border,
        backgroundColor: props.active ? theme.colors.accent : theme.colors.surface,
        opacity: pressed ? 0.85 : 1
      })}
    >
      <Text style={{ color: props.active ? theme.colors.onAccent : theme.colors.text, fontWeight: '700' }}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  searchInput: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15
  }
});
