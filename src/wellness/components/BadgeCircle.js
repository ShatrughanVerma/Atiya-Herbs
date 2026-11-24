import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors } from '../../theme';
import { shortDay } from '../utils/dates';

// One badge: green with its picture when it is won, grey with the progress ("3/7") while it is still to win
export default function BadgeCircle({ badge }) {
  return (
    <View style={styles.cell} accessibilityLabel={`${badge.name} badge`}>
      <View style={[styles.circle, badge.earned && styles.circleOn]}>
        <Icon
          name={badge.icon}
          size={26}
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
  cell: { width: '25%', alignItems: 'center', marginBottom: 14, paddingHorizontal: 2 },
  circle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#E6EAE7',
    borderWidth: 2,
    borderColor: '#D3D9D5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleOn: { backgroundColor: colors.primary, borderColor: '#7FD19E' },
  name: { fontFamily: 'Poppins-Regular', fontSize: 11.5, color: colors.text, textAlign: 'center', marginTop: 6 },
  progress: { fontFamily: 'Poppins-Regular', fontSize: 11.5, color: '#9AA39C' },
  progressOn: { color: colors.primary, fontFamily: 'Poppins-Medium' },
});
