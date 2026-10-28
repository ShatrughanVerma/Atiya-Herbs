import React, {useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import EmptyState from '../components/shop/EmptyState';
import ProductImage from '../components/shop/ProductImage';
import QuantityStepper from '../components/shop/QuantityStepper';
import {useCart} from '../context/CartContext';
import {colors, formatPrice, spacing} from '../theme';

export function BillDetails({mrpTotal, subtotal, couponDiscount, coupon, total}) {
  const savings = mrpTotal - total;
  return (
    <View style={styles.bill}>
      <Text style={styles.billTitle}>Bill details</Text>
      <View style={styles.billRow}>
        <Text style={styles.billLabel}>Total MRP</Text>
        <Text style={styles.billValue}>{formatPrice(mrpTotal)}</Text>
      </View>
      <View style={styles.billRow}>
        <Text style={styles.billLabel}>Discount on MRP</Text>
        <Text style={[styles.billValue, styles.green]}>−{formatPrice(mrpTotal - subtotal)}</Text>
      </View>
      {couponDiscount > 0 && (
        <View style={styles.billRow}>
          <Text style={styles.billLabel}>Coupon ({coupon.code})</Text>
          <Text style={[styles.billValue, styles.green]}>−{formatPrice(couponDiscount)}</Text>
        </View>
      )}
      <View style={styles.billRow}>
        <Text style={styles.billLabel}>Delivery</Text>
        <Text style={[styles.billValue, styles.green]}>FREE</Text>
      </View>
      <View style={[styles.billRow, styles.billTotalRow]}>
        <Text style={styles.billTotal}>To pay</Text>
        <Text style={styles.billTotal}>{formatPrice(total)}</Text>
      </View>
      {savings > 0 && (
        <View style={styles.savings}>
          <Icon name="party-popper" size={16} color={colors.primary} />
          <Text style={styles.savingsText}>You are saving {formatPrice(savings)} on this order</Text>
        </View>
      )}
    </View>
  );
}

export default function CartScreen({navigation}) {
  const cart = useCart();
  const {lines, count, coupon, total, setQty, toggleWishlist, isWishlisted, applyCoupon, removeCoupon} = cart;
  const [code, setCode] = useState('');
  const [couponError, setCouponError] = useState('');

  const onApply = () => {
    if (!code.trim()) {
      return;
    }
    if (applyCoupon(code)) {
      setCouponError('');
      setCode('');
    } else {
      setCouponError('This coupon code is not valid');
    }
  };

  if (lines.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Text style={styles.screenTitle}>My Cart</Text>
        <EmptyState
          icon="cart-outline"
          title="Your cart is empty"
          note="Add herbal remedies you love and they will show up here."
          actionLabel="Start shopping"
          onAction={() => navigation.navigate('ProductList', {title: 'All Products'})}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Text style={styles.screenTitle}>
        My Cart <Text style={styles.screenCount}>({count} items)</Text>
      </Text>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.freeStrip}>
          <Icon name="truck-fast-outline" size={18} color={colors.primary} />
          <Text style={styles.freeText}>Yay! You get FREE delivery on this order</Text>
        </View>

        {lines.map(({product, qty}) => (
          <View key={product.id} style={styles.item}>
            <Pressable onPress={() => navigation.navigate('ProductDetail', {id: product.id})}>
              <ProductImage uri={product.image} style={styles.itemImage} iconSize={28} />
            </Pressable>
            <View style={styles.itemInfo}>
              <Text style={styles.itemName} numberOfLines={2}>
                {product.name}
              </Text>
              <Text style={styles.itemSize}>{product.size}</Text>
              <View style={styles.itemPriceRow}>
                <Text style={styles.itemPrice}>{formatPrice(product.price * qty)}</Text>
                {product.mrp > product.price && (
                  <Text style={styles.itemMrp}>{formatPrice(product.mrp * qty)}</Text>
                )}
              </View>
              <View style={styles.itemActions}>
                <QuantityStepper small qty={qty} onChange={n => setQty(product.id, n)} />
                <Pressable
                  onPress={() => {
                    if (!isWishlisted(product.id)) {
                      toggleWishlist(product.id);
                    }
                    setQty(product.id, 0);
                  }}
                  hitSlop={6}>
                  <Text style={styles.saveLater}>Move to wishlist</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ))}

        <View style={styles.couponBox}>
          {coupon ? (
            <View style={styles.couponApplied}>
              <Icon name="ticket-percent" size={22} color={colors.primary} />
              <View style={styles.couponAppliedText}>
                <Text style={styles.couponCode}>{coupon.code} applied</Text>
                <Text style={styles.couponLabel}>{coupon.label}</Text>
              </View>
              <Pressable onPress={removeCoupon} hitSlop={8}>
                <Text style={styles.couponRemove}>Remove</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.couponRow}>
                <Icon name="ticket-percent-outline" size={22} color={colors.offer} />
                <TextInput
                  style={styles.couponInput}
                  placeholder="Enter coupon code"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="characters"
                  value={code}
                  onChangeText={t => {
                    setCode(t);
                    setCouponError('');
                  }}
                />
                <Pressable onPress={onApply} hitSlop={8}>
                  <Text style={styles.couponApply}>Apply</Text>
                </Pressable>
              </View>
              {!!couponError && <Text style={styles.couponError}>{couponError}</Text>}
              <Text style={styles.couponHint}>Try ATIYA10 or APP5</Text>
            </>
          )}
        </View>

        <BillDetails {...cart} />
      </ScrollView>

      <View style={styles.checkoutBar}>
        <View>
          <Text style={styles.barTotal}>{formatPrice(total)}</Text>
          <Text style={styles.barNote}>Total payable</Text>
        </View>
        <Pressable style={styles.checkoutBtn} onPress={() => navigation.navigate('Checkout')}>
          <Text style={styles.checkoutText}>Checkout</Text>
          <Icon name="arrow-right" size={20} color="#fff" />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.card},
  screenTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: colors.background,
  },
  screenCount: {fontSize: 14, fontWeight: '500', color: colors.muted},
  scroll: {padding: spacing.md, paddingBottom: spacing.lg},
  freeStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  freeText: {marginLeft: 8, color: colors.primary, fontWeight: '700', fontSize: 13},
  item: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  itemImage: {width: 84, height: 84, borderRadius: 10},
  itemInfo: {flex: 1, marginLeft: 12},
  itemName: {fontWeight: '700', color: colors.text, fontSize: 14},
  itemSize: {color: colors.muted, fontSize: 12, marginTop: 2},
  itemPriceRow: {flexDirection: 'row', alignItems: 'baseline', marginTop: 6},
  itemPrice: {fontWeight: '800', fontSize: 15, color: colors.text, marginRight: 6},
  itemMrp: {fontSize: 12, color: colors.muted, textDecorationLine: 'line-through'},
  itemActions: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10},
  saveLater: {color: colors.primary, fontWeight: '600', fontSize: 12},
  couponBox: {
    backgroundColor: colors.background,
    borderRadius: 14,
    padding: 12,
    marginTop: 4,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  couponRow: {flexDirection: 'row', alignItems: 'center'},
  couponInput: {flex: 1, marginHorizontal: 10, color: colors.text, fontSize: 15, paddingVertical: 6},
  couponApply: {color: colors.primary, fontWeight: '800'},
  couponError: {color: colors.danger, fontSize: 12, marginTop: 6},
  couponHint: {color: colors.muted, fontSize: 11, marginTop: 6},
  couponApplied: {flexDirection: 'row', alignItems: 'center'},
  couponAppliedText: {flex: 1, marginLeft: 10},
  couponCode: {fontWeight: '800', color: colors.primary},
  couponLabel: {color: colors.muted, fontSize: 12, marginTop: 2},
  couponRemove: {color: colors.danger, fontWeight: '700'},
  bill: {
    backgroundColor: colors.background,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  billTitle: {fontWeight: '800', fontSize: 15, color: colors.text, marginBottom: 10},
  billRow: {flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8},
  billLabel: {color: colors.muted, fontSize: 14},
  billValue: {color: colors.text, fontSize: 14, fontWeight: '600'},
  green: {color: colors.primary},
  billTotalRow: {borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, marginTop: 4, marginBottom: 0},
  billTotal: {fontWeight: '800', fontSize: 16, color: colors.text},
  savings: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: 8,
    padding: 8,
    marginTop: 12,
  },
  savingsText: {marginLeft: 8, color: colors.primary, fontWeight: '700', fontSize: 12},
  checkoutBar: {
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
  checkoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: 28,
    height: 50,
    borderRadius: 25,
  },
  checkoutText: {color: '#fff', fontWeight: '800', fontSize: 16, marginRight: 8},
});
