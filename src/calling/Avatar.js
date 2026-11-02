import React from 'react';
import {StyleSheet, Text, View} from 'react-native';

// A soft background per person, picked from their name so it stays the same every time
const TONES = ['#2E7D32', '#00897B', '#5C6BC0', '#8E24AA', '#D84315', '#6D4C41', '#00838F', '#AD1457'];

export const initials = name =>
  String(name || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0].toUpperCase())
    .join('') || '?';

const toneFor = name => {
  let sum = 0;
  for (const ch of String(name || '')) {
    sum += ch.charCodeAt(0);
  }
  return TONES[sum % TONES.length];
};

export default function Avatar({name, size = 48}) {
  return (
    <View style={[styles.circle, {width: size, height: size, borderRadius: size / 2, backgroundColor: toneFor(name)}]}>
      <Text style={[styles.text, {fontSize: size * 0.38}]}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {alignItems: 'center', justifyContent: 'center'},
  text: {color: '#fff', fontWeight: '700'},
});
