import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors } from '../../theme';
import { fz, sz } from '../utils/scale';

// The small building blocks of the wellness screens.

export const WELLNESS_BG = '#F2F7F3';
export const BLUE = '#2F80ED';
export const BLUE_LIGHT = '#E6F0FD';

export const MOODS = [
  { id: 'great', emoji: '😄', label: 'Great' },
  { id: 'good', emoji: '🙂', label: 'Good' },
  { id: 'okay', emoji: '😐', label: 'Okay' },
  { id: 'low', emoji: '😔', label: 'Low' },
];
export const moodEmoji = id => MOODS.find(m => m.id === id)?.emoji ?? '';

// A white rounded card
export function Card({ style, children }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

// A card title with a small icon
export function CardTitle({ icon, iconColor = colors.primary, small = false, children }) {
  return (
    <View style={[styles.titleRow, small && styles.titleRowSmall]}>
      <Icon name={icon} size={small ? 18 : 22} color={iconColor} />
      <Text style={[styles.cardTitle, small && styles.cardTitleSmall]}>{children}</Text>
    </View>
  );
}

export function ProgressBar({ percent, color = colors.primary, height = 8 }) {
  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }]}>
      <View
        style={{
          width: `${Math.max(0, Math.min(100, percent))}%`,
          height,
          borderRadius: height / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

// A smooth ring made of many short, overlapping pieces (no SVG package is needed): a grey track, and the first
// `percent` of the circle in green, starting at the top and going clockwise
const PIECES = 120;
export function GoalRing({ percent, size = sz(104), stroke = sz(10), children }) {
  const radius = (size - stroke) / 2;
  const piece = ((2 * Math.PI * radius) / PIECES) * 1.6; // longer than the gap, so neighbours overlap
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * PIECES);
  const pieceStyle = (i, color) => {
    const angle = (i / PIECES) * 2 * Math.PI;
    return {
      position: 'absolute',
      width: piece,
      height: stroke,
      left: size / 2 + radius * Math.sin(angle) - piece / 2,
      top: size / 2 - radius * Math.cos(angle) - stroke / 2,
      backgroundColor: color,
      transform: [{ rotate: `${(i / PIECES) * 360}deg` }],
    };
  };
  return (
    <View style={{ width: size, height: size }}>
      {Array.from({ length: PIECES }, (_, i) => (
        <View key={`t${i}`} style={pieceStyle(i, '#E4EAE5')} />
      ))}
      {Array.from({ length: filled }, (_, i) => (
        <View key={`p${i}`} style={pieceStyle(i, colors.primary)} />
      ))}
      <View style={[styles.ringCenter, { padding: stroke }]}>{children}</View>
    </View>
  );
}

export function MoodPicker({ mood, onChange }) {
  return (
    <View style={styles.moodRow}>
      {MOODS.map(item => {
        const selected = mood === item.id;
        return (
          <Pressable
            key={item.id}
            style={[styles.moodBtn, selected && styles.moodBtnOn]}
            // tapping the chosen mood again clears it
            onPress={() => onChange(selected ? null : item.id)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`Feeling ${item.label}`}
          >
            <Text style={styles.moodEmoji}>{item.emoji}</Text>
            <Text style={styles.moodLabel}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// One small button of a segmented choice (7 days / 30 days / 90 days)
export function Chip({ label, selected, onPress, small = false }) {
  return (
    <Pressable
      style={[styles.chip, small && styles.chipSmall, selected && styles.chipOn]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text style={[styles.chipText, small && styles.chipTextSmall, selected && styles.chipTextOn]}>
        {label}
      </Text>
    </Pressable>
  );
}

// Water of the last 7 days as bars (glasses per day)
export function WeekBars({ week, labelOf, goal, getValue = d => d.glasses }) {
  const top = Math.max(goal, ...week.map(getValue), 1);
  return (
    <View style={styles.weekRow}>
      {week.map((d, i) => {
        const last = i === week.length - 1;
        const value = getValue(d);
        const height = Math.max(4, Math.round((value / top) * sz(80)));
        return (
          <View key={d.day} style={styles.weekCol}>
            <View style={styles.weekBarArea}>
              <View
                style={[
                  styles.weekBar,
                  { height, backgroundColor: value > 0 ? (last ? colors.primary : '#8ED6A8') : '#CFEBD9' },
                ]}
              />
            </View>
            <Text style={[styles.weekLabel, last && styles.weekLabelOn]}>
              {labelOf(d.day)}
            </Text>
            <Text style={styles.weekValue}>{value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: sz(20),
    padding: sz(16),
    marginBottom: sz(14),
    shadowColor: '#0B3D1E',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: sz(0), height: sz(2) },
    elevation: 2,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: sz(10) },
  titleRowSmall: { marginBottom: sz(4) },
  cardTitleSmall: { fontSize: fz(13.5), marginLeft: sz(6) },
  cardTitle: {
    fontFamily: 'Poppins-SemiBold',
    fontSize: fz(16),
    color: colors.text,
    marginLeft: sz(8),
    flexShrink: 1,
  },
  track: { backgroundColor: '#E4EAE5', overflow: 'hidden' },
  ringCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moodRow: { flexDirection: 'row', justifyContent: 'space-between' },
  moodBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: sz(10),
    marginHorizontal: sz(3),
    borderRadius: sz(14),
    backgroundColor: '#F1F6F2',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  moodBtnOn: { backgroundColor: '#E7F8EE', borderColor: colors.primary },
  moodEmoji: { fontSize: fz(26) },
  moodLabel: { fontFamily: 'Poppins-Regular', fontSize: fz(12), color: colors.muted, marginTop: sz(2) },
  chip: {
    paddingHorizontal: sz(16),
    paddingVertical: sz(8),
    borderRadius: sz(20),
    marginRight: sz(8),
  },
  chipSmall: { paddingHorizontal: sz(8), paddingVertical: sz(4), marginRight: sz(5), marginBottom: sz(4) },
  chipOn: { backgroundColor: colors.primary },
  chipText: { fontFamily: 'Poppins-Medium', fontSize: fz(14), color: colors.muted },
  chipTextSmall: { fontSize: fz(12) },
  chipTextOn: { color: '#fff' },
  weekRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: sz(6) },
  weekCol: { flex: 1, alignItems: 'center' },
  weekBarArea: { height: sz(84), justifyContent: 'flex-end' },
  weekBar: { width: sz(22), borderRadius: sz(6) },
  weekLabel: { fontFamily: 'Poppins-Regular', fontSize: fz(12), color: colors.muted, marginTop: sz(6) },
  weekLabelOn: { color: colors.primary, fontFamily: 'Poppins-SemiBold' },
  weekValue: { fontFamily: 'Poppins-Medium', fontSize: fz(13), color: colors.text },
});
