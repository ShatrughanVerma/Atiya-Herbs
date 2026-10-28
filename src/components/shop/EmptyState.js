import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {colors, spacing} from '../../theme';

export default function EmptyState({icon, title, note, actionLabel, onAction}) {
  return (
    <View style={styles.container}>
      <View style={styles.circle}>
        <Icon name={icon} size={44} color={colors.primary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {!!note && <Text style={styles.note}>{note}</Text>}
      {!!actionLabel && (
        <Pressable style={styles.btn} onPress={onAction}>
          <Text style={styles.btnText}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg},
  circle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: {fontSize: 18, fontWeight: '800', color: colors.text, textAlign: 'center'},
  note: {marginTop: 6, color: colors.muted, textAlign: 'center', lineHeight: 20},
  btn: {
    marginTop: spacing.lg,
    backgroundColor: colors.accent,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 24,
  },
  btnText: {color: '#fff', fontWeight: '700', fontSize: 15},
});
