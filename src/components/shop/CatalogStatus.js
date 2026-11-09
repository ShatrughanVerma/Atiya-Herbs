import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useCatalog } from '../../context/CatalogContext';
import { colors, spacing } from '../../theme';

// What to show when the shop's data is not there. There is no pretend data: either it is loading, or the server
// could not be reached and the person can try again.
export function CatalogUnavailable({ compact = false }) {
  const { loading, retry } = useCatalog();
  if (loading) {
    return (
      <View style={[styles.box, compact && styles.compact]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.note}>Loading the shop…</Text>
      </View>
    );
  }
  return (
    <View
      style={[styles.box, compact && styles.compact]}
      accessibilityRole="alert"
    >
      <View style={styles.circle}>
        <Icon name="cloud-off-outline" size={40} color={colors.primary} />
      </View>
      <Text style={styles.title}>Server not reachable</Text>
      <Text style={styles.note}>
        You seem to be offline, or our server is not answering. Please check your
        internet and try again.
      </Text>
      <Pressable
        style={styles.btn}
        onPress={retry}
        accessibilityRole="button"
        accessibilityLabel="Retry"
      >
        <Text style={styles.btnText}>Retry</Text>
      </Pressable>
    </View>
  );
}

// A thin strip shown above a screen when what it shows is the saved copy, not fresh from the server
export function OfflineBanner() {
  const { stale, retry } = useCatalog();
  if (!stale) {
    return null;
  }
  return (
    <Pressable
      style={styles.banner}
      onPress={retry}
      accessibilityRole="button"
      accessibilityLabel="You are offline. Tap to refresh"
    >
      <Icon name="wifi-off" size={14} color="#7A5B00" />
      <Text style={styles.bannerText}>
        Offline: showing saved products. Tap to refresh.
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  compact: { flex: 0, paddingVertical: spacing.lg },
  circle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: { fontSize: 18, fontWeight: '800', color: colors.text, textAlign: 'center' },
  note: { marginTop: 8, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  btn: {
    marginTop: spacing.lg,
    backgroundColor: colors.accent,
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 24,
  },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF3CD',
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
  },
  bannerText: { marginLeft: 6, color: '#7A5B00', fontSize: 12, fontWeight: '600' },
});
