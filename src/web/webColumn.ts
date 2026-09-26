import { Platform, type ViewStyle } from 'react-native';

/**
 * On the web, keeps a phone-shaped screen (login, email sign-in) at a
 * readable width in the middle of a desktop window. Undefined on iOS and
 * Android, so their layouts are unchanged.
 */
export const webColumn: ViewStyle | undefined =
  Platform.OS === 'web' ? { width: '100%', maxWidth: 480, alignSelf: 'center' } : undefined;
