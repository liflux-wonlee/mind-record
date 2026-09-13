import { router } from 'expo-router';

/**
 * Return to the tabbed app from a full-screen route (Talk, Summary, Driving).
 *
 * These screens sit on top of the tab navigator in the root stack, so they are
 * dismissed rather than replaced — replacing would stack a second copy of the
 * tabs (and a second nav bar) underneath.
 */
export function dismissToTabs() {
  if (router.canDismiss()) router.dismissAll();
  else router.replace('/');
}
