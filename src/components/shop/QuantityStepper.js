import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {colors} from '../../theme';

export default function QuantityStepper({qty, onChange, small = false, max = 10}) {
  const size = small ? 28 : 36;
  return (
    <View style={[styles.row, {height: size}]}>
      <Pressable
        style={[styles.btn, {width: size, height: size}]}
        onPress={() => onChange(qty - 1)}
        hitSlop={6}
        accessibilityLabel="Decrease quantity">
        <Icon name={qty === 1 ? 'trash-can-outline' : 'minus'} size={small ? 15 : 18} color="#fff" />
      </Pressable>
      <Text style={[styles.qty, small && styles.qtySmall]}>{qty}</Text>
      <Pressable
        style={[styles.btn, {width: size, height: size}, qty >= max && styles.disabled]}
        onPress={() => qty < max && onChange(qty + 1)}
        hitSlop={6}
        accessibilityLabel="Increase quantity">
        <Icon name="plus" size={small ? 15 : 18} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accentLight,
    borderRadius: 20,
  },
  btn: {
    backgroundColor: colors.accent,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {opacity: 0.4},
  qty: {minWidth: 32, textAlign: 'center', fontWeight: '800', fontSize: 15, color: colors.text},
  qtySmall: {minWidth: 24, fontSize: 13},
});
