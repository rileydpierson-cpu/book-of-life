export type RootStackParamList = {
  HomeTimeline: { focusDate?: string } | undefined;
  Explorer: { year?: number | null; monthKey?: string | null } | undefined;
  Search: { initialQuery?: string } | undefined;
  JournalEditor: { isoDate: string };
  MediaViewer: { initialItemKey: string; isoDate?: string };
  Settings: undefined;
};
