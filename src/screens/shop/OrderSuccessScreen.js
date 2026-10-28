import React, {useEffect, useRef} from 'react';
import {Animated, Pressable, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useCart} from '../../context/CartContext';
import {colors, formatPrice, spacing} from '../../theme';

export default function OrderSuccessScreen({navigation, route}) {
  const {orders} = useCart();
  const order = orders.find(o => o.id === route.params.orderId);
  const scale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(scale, {toValue: 1, friction: 5, useNativeDriver: true}).start();
  }, [scale]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <Animated.View style={[styles.circle, {transform: [{scale}]}]}>
          <Icon name="check-bold" size={56} color="#fff" />
        </Animated.View>
        <Text style={styles.title}>Order placed!</Text>
        <Text style={styles.note}>Thank you for shopping with Atiya Herbs. We'll send you updates as your order moves.</Text>

        {!!order && (
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.label}>Order ID</Text>
              <Text style={styles.value}>#{order.id}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Amount</Text>
              <Text style={styles.value}>{formatPrice(order.total)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Payment</Text>
              <Text style={styles.value}>{order.paymentMethod.title}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Expected delivery</Text>
              <Text style={styles.value}>4–7 days</Text>
            </View>
          </View>
        )}
      </View>

      <View style={styles.actions}>
        <Pressable style={[styles.btn, styles.outline]} onPress={() => navigation.replace('Orders')}>
          <Text style={[styles.btnText, styles.outlineText]}>View my orders</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => navigation.navigate('Main', {screen: 'Home'})}>
          <Text style={styles.btnText}>Continue shopping</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background},
  content: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg},
  circle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 10,
    borderColor: colors.primaryLight,
  },
  title: {fontSize: 26, fontWeight: '800', color: colors.text, marginTop: spacing.lg},
  note: {color: colors.muted, textAlign: 'center', marginTop: 8, lineHeight: 20},
  card: {
    width: '100%',
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: spacing.md,
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: {flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6},
  label: {color: colors.muted},
  value: {color: colors.text, fontWeight: '700'},
  actions: {padding: spacing.md},
  btn: {
    backgroundColor: colors.accent,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  outline: {backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.primary},
  btnText: {color: '#fff', fontWeight: '800', fontSize: 16},
  outlineText: {color: colors.primary},
});
