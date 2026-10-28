import React, {useState} from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ScreenHeader from '../../components/shop/ScreenHeader';
import ProductImage from '../../components/shop/ProductImage';
import {useCart} from '../../context/CartContext';
import {BillDetails} from '../CartScreen';
import {colors, formatPrice, spacing} from '../../theme';

const PAYMENT_METHODS = [
  {id: 'upi', icon: 'cellphone-check', title: 'UPI', note: 'Google Pay, PhonePe, Paytm & more'},
  {id: 'card', icon: 'credit-card-outline', title: 'Credit / Debit Card', note: 'Visa, Mastercard, RuPay'},
  {id: 'netbanking', icon: 'bank-outline', title: 'Net Banking', note: 'All major banks'},
  {id: 'cod', icon: 'cash', title: 'Cash on Delivery', note: 'Pay when your order arrives'},
];

const FIELDS = [
  {key: 'name', label: 'Full name', autoCapitalize: 'words'},
  {key: 'phone', label: 'Mobile number', keyboardType: 'phone-pad', maxLength: 10},
  {key: 'pincode', label: 'Pincode', keyboardType: 'number-pad', maxLength: 6, half: true},
  {key: 'city', label: 'City', autoCapitalize: 'words', half: true},
  {key: 'line1', label: 'House no., building, street', autoCapitalize: 'sentences'},
  {key: 'line2', label: 'Area, landmark (optional)', autoCapitalize: 'sentences'},
  {key: 'state', label: 'State', autoCapitalize: 'words'},
];

const validate = a => {
  const errors = {};
  if (a.name.trim().length < 2) {
    errors.name = 'Enter your full name';
  }
  if (!/^[6-9][0-9]{9}$/.test(a.phone)) {
    errors.phone = 'Enter a valid 10-digit mobile number';
  }
  if (!/^[1-9][0-9]{5}$/.test(a.pincode)) {
    errors.pincode = 'Enter a valid pincode';
  }
  if (!a.city.trim()) {
    errors.city = 'Enter your city';
  }
  if (a.line1.trim().length < 5) {
    errors.line1 = 'Enter your full address';
  }
  if (!a.state.trim()) {
    errors.state = 'Enter your state';
  }
  return errors;
};

export default function CheckoutScreen({navigation}) {
  const cart = useCart();
  const {lines, total, placeOrder} = cart;
  const [address, setAddress] = useState({name: '', phone: '', pincode: '', city: '', line1: '', line2: '', state: ''});
  const [errors, setErrors] = useState({});
  const [payment, setPayment] = useState('upi');

  const update = (key, value) => {
    setAddress(a => ({...a, [key]: key === 'phone' || key === 'pincode' ? value.replace(/[^0-9]/g, '') : value}));
    setErrors(e => ({...e, [key]: undefined}));
  };

  const onPlaceOrder = () => {
    const found = validate(address);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }
    // TODO: for online methods, create a Razorpay order on the backend and open Razorpay checkout here.
    const order = placeOrder({address, paymentMethod: PAYMENT_METHODS.find(m => m.id === payment)});
    navigation.reset({
      index: 1,
      routes: [{name: 'Main'}, {name: 'OrderSuccess', params: {orderId: order.id}}],
    });
  };

  if (lines.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Checkout" navigation={navigation} />
        <Text style={styles.emptyNote}>Your cart is empty.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader title="Checkout" navigation={navigation} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.steps}>
            {['Cart', 'Address', 'Payment'].map((s, i) => (
              <React.Fragment key={s}>
                <View style={styles.step}>
                  <View style={[styles.stepDot, styles.stepDotDone]}>
                    <Icon name={i === 0 ? 'check' : 'circle-small'} size={14} color="#fff" />
                  </View>
                  <Text style={styles.stepText}>{s}</Text>
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
            <View style={styles.fieldWrap}>
              {FIELDS.map(f => (
                <View key={f.key} style={f.half ? styles.half : styles.full}>
                  <Text style={styles.label}>{f.label}</Text>
                  <TextInput
                    style={[styles.input, errors[f.key] && styles.inputError]}
                    value={address[f.key]}
                    onChangeText={v => update(f.key, v)}
                    keyboardType={f.keyboardType}
                    autoCapitalize={f.autoCapitalize}
                    maxLength={f.maxLength}
                    placeholderTextColor={colors.muted}
                  />
                  {!!errors[f.key] && <Text style={styles.error}>{errors[f.key]}</Text>}
                </View>
              ))}
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Icon name="wallet-outline" size={20} color={colors.primary} />
              <Text style={styles.cardTitle}>Payment method</Text>
            </View>
            {PAYMENT_METHODS.map(m => {
              const selected = payment === m.id;
              return (
                <Pressable
                  key={m.id}
                  style={[styles.payRow, selected && styles.payRowSelected]}
                  onPress={() => setPayment(m.id)}
                  accessibilityRole="radio"
                  accessibilityState={{selected}}>
                  <View style={styles.payIcon}>
                    <Icon name={m.icon} size={22} color={colors.primary} />
                  </View>
                  <View style={styles.payInfo}>
                    <Text style={styles.payTitle}>{m.title}</Text>
                    <Text style={styles.payNote}>{m.note}</Text>
                  </View>
                  <Icon
                    name={selected ? 'radiobox-marked' : 'radiobox-blank'}
                    size={22}
                    color={selected ? colors.primary : colors.muted}
                  />
                </Pressable>
              );
            })}
            <View style={styles.secure}>
              <Icon name="lock-outline" size={14} color={colors.muted} />
              <Text style={styles.secureText}>Payments are 100% secure and encrypted</Text>
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
      </KeyboardAvoidingView>

      <View style={styles.bar}>
        <View>
          <Text style={styles.barTotal}>{formatPrice(total)}</Text>
          <Text style={styles.barNote}>{payment === 'cod' ? 'Pay on delivery' : 'Pay now'}</Text>
        </View>
        <Pressable style={styles.placeBtn} onPress={onPlaceOrder}>
          <Text style={styles.placeText}>{payment === 'cod' ? 'Place Order' : 'Pay & Place Order'}</Text>
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
  fieldWrap: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between'},
  full: {width: '100%', marginBottom: 10},
  half: {width: '48%', marginBottom: 10},
  label: {fontSize: 12, color: colors.muted, marginBottom: 4, fontWeight: '600'},
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 46,
    color: colors.text,
    fontSize: 15,
  },
  inputError: {borderColor: colors.danger},
  error: {color: colors.danger, fontSize: 11, marginTop: 4},
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
  secure: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 4},
  secureText: {fontSize: 11, color: colors.muted, marginLeft: 4},
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
  placeBtn: {backgroundColor: colors.accent, paddingHorizontal: 24, height: 50, borderRadius: 25, justifyContent: 'center'},
  placeText: {color: '#fff', fontWeight: '800', fontSize: 16},
});
