import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors } from '../../theme';
import { shortDay } from '../utils/dates';
import { fz, sz } from '../utils/scale';

// One badge: green with its picture when it is won, grey with the progress ("3/7") while it is still to win
export default function BadgeCircle({ badge }) {
  return (
    <View style={styles.cell} accessibilityLabel={`${badge.name} badge`}>
      <View style={[styles.circle, badge.earned && styles.circleOn]}>
        <Icon
          name={badge.icon}
          size={sz(26)}
          color={badge.earned ? '#fff' : '#9AA39C'}
        />
      </View>
      <Text style={styles.name} numberOfLines={2}>
        {badge.name}
      </Text>
      <Text style={[styles.progress, badge.earned && styles.progressOn]}>
        {badge.earned && badge.earnedOn
          ? shortDay(badge.earnedOn)
          : `${badge.progress}/${badge.target}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cell: { width: '25%', alignItems: 'center', marginBottom: sz(14), paddingHorizontal: sz(2) },
  circle: {
    width: sz(54),
    height: sz(54),
    borderRadius: sz(27),
    backgroundColor: '#E6EAE7',
    borderWidth: 2,
    borderColor: '#D3D9D5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleOn: { backgroundColor: colors.primary, borderColor: '#7FD19E' },
  name: { fontFamily: 'Poppins-Regular', fontSize: fz(11.5), color: colors.text, textAlign: 'center', marginTop: sz(6) },
  progress: { fontFamily: 'Poppins-Regular', fontSize: fz(11.5), color: '#9AA39C' },
  progressOn: { color: colors.primary, fontFamily: 'Poppins-Medium' },
});
