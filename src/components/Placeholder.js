import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {colors} from '../theme';

export default function Placeholder({title, note}) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {!!note && <Text style={styles.note}>{note}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: 24},
  title: {fontSize: 22, fontWeight: '700', color: colors.primary},
  note: {marginTop: 8, color: colors.muted, textAlign: 'center'},
});
