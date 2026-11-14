import React from 'react';
import {StyleSheet} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import EmptyState from '../components/shop/EmptyState';
import {colors} from '../theme';

// The clinic stock screen is not built yet; the tab is here so the doctor's bar matches the design.
export default function DoctorStockScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <EmptyState icon="cube-outline" title="Clinic stock" note="This is coming soon." />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background},
});
