import { Platform } from 'react-native';

// "Redmi Note 10": shown in the backend's list of logins. Optional, never blocks a login.
export default function deviceName() {
  const c = Platform.constants || {};
  return (
    [c.Brand, c.Model]
      .filter(Boolean)
      .join(' ')
      .split('')
      .filter(ch => ch !== '<' && ch !== '>' && ch.charCodeAt(0) > 31)
      .join('')
      .slice(0, 100) || undefined
  );
}
