export type ThemeName = 'light' | 'dark' | 'sepia' | 'forest' | 'ocean' | 'rose';

export type AppTheme = {
  name: ThemeName;
  colors: {
    background: string;
    surface: string;
    surfaceMuted: string;
    surfaceAccent: string;
    border: string;
    text: string;
    textMuted: string;
    accent: string;
    accentSoft: string;
    success: string;
    warning: string;
    info: string;
    destructive: string;
    onAccent: string;
    overlay: string;
    shadow: string;
  };
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
  };
  radius: {
    sm: number;
    md: number;
    lg: number;
    xl: number;
    pill: number;
  };
  typography: {
    brandTitle: number;
    screenTitle: number;
    sectionTitle: number;
    body: number;
    caption: number;
    meta: number;
  };
};

const baseTheme = {
  spacing: {
    xs: 6,
    sm: 10,
    md: 16,
    lg: 20,
    xl: 28,
    xxl: 36
  },
  radius: {
    sm: 12,
    md: 16,
    lg: 22,
    xl: 28,
    pill: 999
  },
  typography: {
    brandTitle: 34,
    screenTitle: 28,
    sectionTitle: 22,
    body: 15,
    caption: 13,
    meta: 12
  }
} as const;

export const THEMES: Record<ThemeName, AppTheme> = {
  light: {
    name: 'light',
    ...baseTheme,
    colors: {
      background: '#f2ede4',
      surface: '#fffaf0',
      surfaceMuted: '#f6efe0',
      surfaceAccent: '#f3f8fc',
      border: '#dccfb9',
      text: '#221d18',
      textMuted: '#6e6458',
      accent: '#2f5f87',
      accentSoft: '#ddeaf4',
      success: '#3f7d4f',
      warning: '#b27b28',
      info: '#466c9b',
      destructive: '#b04a45',
      onAccent: '#ffffff',
      overlay: 'rgba(17, 12, 8, 0.56)',
      shadow: 'rgba(58, 38, 18, 0.12)'
    }
  },
  dark: {
    name: 'dark',
    ...baseTheme,
    colors: {
      background: '#12100d',
      surface: '#1c1813',
      surfaceMuted: '#262018',
      surfaceAccent: '#1f2730',
      border: '#393126',
      text: '#f7f0e2',
      textMuted: '#b7ab98',
      accent: '#7ba9d6',
      accentSoft: '#22354a',
      success: '#79be88',
      warning: '#dfb56b',
      info: '#88aee2',
      destructive: '#df8b83',
      onAccent: '#0c1621',
      overlay: 'rgba(0, 0, 0, 0.62)',
      shadow: 'rgba(0, 0, 0, 0.36)'
    }
  },
  sepia: {
    name: 'sepia',
    ...baseTheme,
    colors: {
      background: '#f3e8d3',
      surface: '#fff7e9',
      surfaceMuted: '#f4ead7',
      surfaceAccent: '#f9f1e2',
      border: '#d8c0a1',
      text: '#3b2e22',
      textMuted: '#7c6854',
      accent: '#8a5a2d',
      accentSoft: '#f0dfc4',
      success: '#617b43',
      warning: '#b17824',
      info: '#5f6d87',
      destructive: '#a44a38',
      onAccent: '#fff8ef',
      overlay: 'rgba(39, 24, 11, 0.42)',
      shadow: 'rgba(74, 49, 24, 0.14)'
    }
  },
  forest: {
    name: 'forest',
    ...baseTheme,
    colors: {
      background: '#e7efe7',
      surface: '#f8fbf6',
      surfaceMuted: '#e9f2e6',
      surfaceAccent: '#ebf5f1',
      border: '#bfd1bf',
      text: '#1f3124',
      textMuted: '#5e7461',
      accent: '#2f6b4f',
      accentSoft: '#d8ebe0',
      success: '#2f7a49',
      warning: '#a1782e',
      info: '#3f6c7e',
      destructive: '#994b43',
      onAccent: '#f5fff9',
      overlay: 'rgba(14, 29, 18, 0.5)',
      shadow: 'rgba(22, 46, 29, 0.12)'
    }
  },
  ocean: {
    name: 'ocean',
    ...baseTheme,
    colors: {
      background: '#e7f1f5',
      surface: '#fbfeff',
      surfaceMuted: '#e8f3f8',
      surfaceAccent: '#e5f2fb',
      border: '#bfd6e2',
      text: '#193142',
      textMuted: '#5a7485',
      accent: '#2d6f99',
      accentSoft: '#d7ebf7',
      success: '#36755e',
      warning: '#a06b2d',
      info: '#376e9b',
      destructive: '#a04d4a',
      onAccent: '#f8fcff',
      overlay: 'rgba(7, 23, 38, 0.44)',
      shadow: 'rgba(15, 46, 66, 0.12)'
    }
  },
  rose: {
    name: 'rose',
    ...baseTheme,
    colors: {
      background: '#f7ecee',
      surface: '#fff8f8',
      surfaceMuted: '#f8ebec',
      surfaceAccent: '#fff0f3',
      border: '#e2c6cb',
      text: '#3a232a',
      textMuted: '#7f646c',
      accent: '#9d5064',
      accentSoft: '#f4dce4',
      success: '#5f7b55',
      warning: '#ab7432',
      info: '#6c6895',
      destructive: '#b14b5f',
      onAccent: '#fff9fb',
      overlay: 'rgba(50, 17, 27, 0.42)',
      shadow: 'rgba(77, 34, 47, 0.12)'
    }
  }
};
