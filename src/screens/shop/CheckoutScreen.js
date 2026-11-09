import React, {useCallback, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AddressPicker from '../../components/shop/AddressPicker';
import EmptyState from '../../components/shop/EmptyState';
import ScreenHeader from '../../components/shop/ScreenHeader';
import ProductImage from '../../components/shop/ProductImage';
import {useCart} from '../../context/CartContext';
import {BillDetails} from '../CartScreen';
import {colors, formatPrice, spacing} from '../../theme';

// Checkout: needs a login (the cart, the addresses and the order all live on the server). Cash on delivery only:
// no card or online payment is handled in the app.
export default function CheckoutScreen({navigation}) {
  const cart = useCart();
  const {lines, total, placeOrder, loggedIn, hasBlocking, refreshCart} = cart;
  const [address, setAddress] = useState(null);
  const [placing, setPlacing] = useState(false);
  const onSelect = useCallback(a => setAddress(a), []);

  const onPlaceOrder = async () => {
    if (!address || placing) {
      return;
    }
    setPlacing(true);
    try {
      const order = await placeOrder({addressId: address.id});
      navigation.reset({
        index: 1,
        routes: [{name: 'Main'}, {name: 'OrderSuccess', params: {orderId: order.id}}],
      });
    } catch (error) {
      Alert.alert('Order not placed', error.message || 'Please try again.');
      refreshCart(); // the stock may have changed: show the cart as it is now
    } finally {
      setPlacing(false);
    }
  };

  if (!loggedIn) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Checkout" navigation={navigation} />
        <EmptyState
          icon="account-lock-outline"
          title="Log in to place your order"
          note="Your cart is kept. After you log in you can pick your delivery address and place the order."
          actionLabel="Log in"
          onAction={() => navigation.navigate('Login')}
        />
      </SafeAreaView>
    );
  }

  if (lines.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Checkout" navigation={navigation} />
        <Text style={styles.emptyNote}>Your cart is empty.</Text>
      </SafeAreaView>
    );
  }

  if (hasBlocking) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Checkout" navigation={navigation} />
        <EmptyState
          icon="alert-circle-outline"
          title="Some items cannot be ordered"
          note="An item in your cart is out of stock or no longer available. Please remove it and try again."
          actionLabel="Back to cart"
          onAction={() => navigation.goBack()}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader title="Checkout" navigation={navigation} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.steps}>
          {['Cart', 'Address', 'Payment'].map((step, i) => (
            <React.Fragment key={step}>
              <View style={styles.step}>
                <View style={[styles.stepDot, styles.stepDotDone]}>
                  <Icon name={i === 0 ? 'check' : 'circle-small'} size={14} color="#fff" />
                </View>
                <Text style={styles.stepText}>{step}</Text>
              </View>
              {i < 2 && <View style={styles.stepLine} />}
            </React.Fragment>
          ))}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Icon name="map-marker-outline" size={20} color={colors.primary} />
            <Text style={styles.cardTitle}>Delivery address</Text>
          </View>
          <AddressPicker selectedId={address?.id} onSelect={onSelect} />
        </View>

        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Icon name="wallet-outline" size={20} color={colors.primary} />
            <Text style={styles.cardTitle}>Payment</Text>
          </View>
          <View style={[styles.payRow, styles.payRowSelected]}>
            <View style={styles.payIcon}>
              <Icon name="cash" size={22} color={colors.primary} />
            </View>
            <View style={styles.payInfo}>
              <Text style={styles.payTitle}>Cash on Delivery</Text>
              <Text style={styles.payNote}>Pay when your order arrives</Text>
            </View>
            <Icon name="radiobox-marked" size={22} color={colors.primary} />
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Icon name="package-variant-closed" size={20} color={colors.primary} />
            <Text style={styles.cardTitle}>Order summary ({lines.length} items)</Text>
          </View>
          {lines.map(({product, qty}) => (
            <View key={product.id} style={styles.sumRow}>
              <ProductImage uri={product.image} style={styles.sumImage} iconSize={18} />
              <Text style={styles.sumName} numberOfLines={1}>
                {product.name} × {qty}
              </Text>
              <Text style={styles.sumPrice}>{formatPrice(product.price * qty)}</Text>
            </View>
          ))}
        </View>

        <BillDetails {...cart} />
      </ScrollView>

      <View style={styles.bar}>
        <View>
          <Text style={styles.barTotal}>{formatPrice(total)}</Text>
          <Text style={styles.barNote}>Pay on delivery</Text>
        </View>
        <Pressable
          style={[styles.placeBtn, (!address || placing) && styles.placeBtnOff]}
          onPress={onPlaceOrder}
          disabled={!address || placing}
          accessibilityRole="button"
          accessibilityState={{disabled: !address || placing}}
          accessibilityLabel="Place order">
          {placing ? <ActivityIndicator color="#fff" /> : <Text style={styles.placeText}>Place Order</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.card},
  flex: {flex: 1},
  scroll: {padding: spacing.md, paddingBottom: spacing.lg},
  emptyNote: {textAlign: 'center', marginTop: 40, color: colors.muted},
  steps: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md},
  step: {alignItems: 'center'},
  stepDot: {width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center'},
  stepDotDone: {backgroundColor: colors.primary},
  stepText: {fontSize: 11, color: colors.text, marginTop: 4, fontWeight: '600'},
  stepLine: {width: 50, height: 2, backgroundColor: colors.primary, marginHorizontal: 6, marginBottom: 14},
  card: {
    backgroundColor: colors.background,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHead: {flexDirection: 'row', alignItems: 'center', marginBottom: 12},
  cardTitle: {fontSize: 16, fontWeight: '800', color: colors.text, marginLeft: 8},
  payRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  payRowSelected: {borderColor: colors.primary, backgroundColor: colors.primaryLight},
  payIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payInfo: {flex: 1, marginLeft: 12},
  payTitle: {fontWeight: '700', color: colors.text},
  payNote: {fontSize: 12, color: colors.muted, marginTop: 2},
  sumRow: {flexDirection: 'row', alignItems: 'center', marginBottom: 10},
  sumImage: {width: 40, height: 40, borderRadius: 8},
  sumName: {flex: 1, marginHorizontal: 10, color: colors.text},
  sumPrice: {fontWeight: '700', color: colors.text},
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  barTotal: {fontSize: 20, fontWeight: '800', color: colors.text},
  barNote: {fontSize: 11, color: colors.muted},
  placeBtn: {backgroundColor: colors.accent, paddingHorizontal: 24, minHeight: 50, borderRadius: 25, justifyContent: 'center'},
  placeBtnOff: {opacity: 0.5},
  placeText: {color: '#fff', fontWeight: '800', fontSize: 16},
});
