import { createContext, useContext } from 'react';

/**
 * True inside screens drawn above the app's own bottom tab bar (the tabs and
 * WithBottomNav drill-downs) -- the bar already keeps clear of the system
 * navigation bar there. Everywhere else, Screen pads its bottom by the
 * system bar's height so the last row can scroll clear of it.
 */
export const BottomNavContext = createContext(false);

export function useInsideBottomNav(): boolean {
  return useContext(BottomNavContext);
}
