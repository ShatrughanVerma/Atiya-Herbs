export const colors = {
  // Palette follows the Vaidban reference: deep green, mint sections, orange buttons
  primary: '#217843',
  primaryDark: '#14532D',
  primaryLight: '#E7F8EE',
  authGreen: '#41AA7D', // Login screen
  accent: '#FF8D32',
  accentLight: '#FFF1E6',
  background: '#FFFFFF',
  card: '#F6F8F4',
  cream: '#FFF8E7',
  creamBorder: '#F0E6CC',
  text: '#121212',
  muted: '#6B7280',
  border: '#E5E7EB',
  star: '#FFA000',
  offer: '#FF8F00',
  danger: '#D32F2F',
};
export const spacing = {xs: 4, sm: 8, md: 16, lg: 24};

export const formatPrice = amount => `₹${Math.round(amount).toLocaleString('en-IN')}`;
