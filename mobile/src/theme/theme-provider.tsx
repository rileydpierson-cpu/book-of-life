import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { THEMES, type AppTheme, type ThemeName } from './themes';

const THEME_KEY = 'lifeserver-mobile-theme-v1';

type ThemeContextValue = {
  theme: AppTheme;
  themeName: ThemeName;
  setThemeName: (name: ThemeName) => Promise<void>;
  fontsLoaded: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider(props: {
  children: React.ReactNode;
  fontsLoaded: boolean;
}) {
  const [themeName, setThemeNameState] = useState<ThemeName>('light');

  useEffect(() => {
    SecureStore.getItemAsync(THEME_KEY)
      .then((value) => {
        if (value && value in THEMES) {
          setThemeNameState(value as ThemeName);
        }
      })
      .catch(() => {});
  }, []);

  async function setThemeName(name: ThemeName) {
    setThemeNameState(name);
    await SecureStore.setItemAsync(THEME_KEY, name);
  }

  const value = useMemo(() => ({
    theme: THEMES[themeName],
    themeName,
    setThemeName,
    fontsLoaded: props.fontsLoaded
  }), [themeName, props.fontsLoaded]);

  return (
    <ThemeContext.Provider value={value}>
      {props.children}
    </ThemeContext.Provider>
  );
}

export function useAppTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useAppTheme must be used inside ThemeProvider.');
  return context;
}
