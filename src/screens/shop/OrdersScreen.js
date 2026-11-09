import React, {useEffect} from 'react';
import {ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import EmptyState from '../../components/shop/EmptyState';
import ProductImage from '../../components/shop/ProductImage';
import ScreenHeader from '../../components/shop/ScreenHeader';
import {useCart} from '../../context/CartContext';
import {colors, formatPrice, spacing} from '../../theme';

// What the server calls each stage, and what the person reads
const STAGES = ['placed', 'confirmed', 'shipped', 'delivered'];
const STEPS = ['Placed', 'Confirmed', 'Shipped', 'Delivered'];
const CANCELLABLE = ['placed', 'confirmed'];

const formatDate = iso =>
  new Date(iso).toLocaleDateString('en-IN', {day: 'numeric', month: 'short', year: 'numeric'});

function Timeline({status}) {
  const current = STAGES.indexOf(status);
  return (
    <View style={styles.timeline}>
      {STEPS.map((step, i) => {
        const done = i <= current;
        return (
          <React.Fragment key={step}>
            <View style={styles.tStep}>
              <View style={[styles.tDot, done && styles.tDotDone]}>
                {done && <Icon name="check" size={10} color="#fff" />}
              </View>
              <Text style={[styles.tText, done && styles.tTextDone]}>{step}</Text>
            </View>
            {i < STEPS.length - 1 && <View style={[styles.tLine, i < current && styles.tLineDone]} />}
          </React.Fragment>
        );
      })}
    </View>
  );
}

export default function OrdersScreen({navigation}) {
  const {orders, ordersStatus, refreshOrders, cancelOrder, loggedIn} = useCart();

  useEffect(() => {
    if (loggedIn) {
      refreshOrders();
    }
  }, [loggedIn, refreshOrders]);

  const onCancel = order =>
    Alert.alert('Cancel order', `Cancel order #${order.orderNumber}?`, [
      {text: 'Keep it', style: 'cancel'},
      {
        text: 'Cancel order',
        style: 'destructive',
        onPress: async () => {
          try {
            await cancelOrder(order.id);
          } catch (error) {
            Alert.alert('Order', error.message);
            refreshOrders();
          }
        },
      },
    ]);

  if (!loggedIn) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <ScreenHeader title="My Orders" navigation={navigation} />
        <EmptyState
          icon="account-lock-outline"
          title="Log in to see your orders"
          note="Your orders are saved with your account."
          actionLabel="Log in"
          onAction={() => navigation.navigate('Login')}
        />
      </SafeAreaView>
    );
  }

  if (orders.length === 0 && ordersStatus === 'loading') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <ScreenHeader title="My Orders" navigation={navigation} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (orders.length === 0 && ordersStatus === 'error') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <ScreenHeader title="My Orders" navigation={navigation} />
        <EmptyState
          icon="cloud-off-outline"
          title="Could not load your orders"
          note="Please check your internet and try again."
          actionLabel="Retry"
          onAction={refreshOrders}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader title="My Orders" navigation={navigation} />
      <FlatList
        data={orders}
        keyExtractor={o => o.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState
            icon="package-variant"
            title="No orders yet"
            note="When you place an order, you can track it here."
            actionLabel="Start shopping"
            onAction={() => navigation.navigate('ProductList', {title: 'All Products'})}
          />
        }
        renderItem={({item: order}) => (
          <View style={styles.card}>
            <View style={styles.head}>
              <View>
                <Text style={styles.orderId}>Order #{order.orderNumber}</Text>
                <Text style={styles.date}>{formatDate(order.createdAt)}</Text>
              </View>
              <View style={styles.status}>
                <Text style={styles.statusText}>
                  {order.status === 'cancelled' ? 'Cancelled' : STEPS[STAGES.indexOf(order.status)]}
                </Text>
              </View>
            </View>

            {order.items.map(({productId, name, image, qty}) => (
              <View key={productId} style={styles.line}>
                <ProductImage uri={image} style={styles.thumb} iconSize={18} />
                <Text style={styles.lineName} numberOfLines={1}>
                  {name}
                </Text>
                <Text style={styles.lineQty}>× {qty}</Text>
              </View>
            ))}

            {order.status !== 'cancelled' && <Timeline status={order.status} />}

            <View style={styles.foot}>
              <Text style={styles.footLabel}>Cash on Delivery</Text>
              <Text style={styles.total}>{formatPrice(order.total)}</Text>
            </View>
            {CANCELLABLE.includes(order.status) && (
              <Pressable
                style={styles.cancelBtn}
                onPress={() => onCancel(order)}
                accessibilityRole="button"
                accessibilityLabel={`Cancel order ${order.orderNumber}`}>
                <Text style={styles.cancelText}>Cancel order</Text>
              </Pressable>
            )}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.card},
  list: {padding: spacing.md, flexGrow: 1},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  cancelBtn: {alignSelf: 'flex-end', marginTop: 10, paddingVertical: 6, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.danger},
  cancelText: {color: colors.danger, fontWeight: '700', fontSize: 13},
  card: {
    backgroundColor: colors.background,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  head: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10},
  orderId: {fontWeight: '800', color: colors.text},
  date: {color: colors.muted, fontSize: 12, marginTop: 2},
  status: {backgroundColor: colors.primaryLight, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4},
  statusText: {color: colors.primary, fontWeight: '700', fontSize: 12},
  line: {flexDirection: 'row', alignItems: 'center', marginBottom: 8},
  thumb: {width: 36, height: 36, borderRadius: 8},
  lineName: {flex: 1, marginHorizontal: 10, color: colors.text},
  lineQty: {color: colors.muted},
  timeline: {flexDirection: 'row', alignItems: 'flex-start', marginTop: 8, marginBottom: 4},
  tStep: {alignItems: 'center', width: 58},
  tDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tDotDone: {backgroundColor: colors.primary, borderColor: colors.primary},
  tText: {fontSize: 10, color: colors.muted, marginTop: 4},
  tTextDone: {color: colors.primary, fontWeight: '700'},
  tLine: {flex: 1, height: 2, backgroundColor: colors.border, marginTop: 8},
  tLineDone: {backgroundColor: colors.primary},
  foot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
    marginTop: 10,
  },
  footLabel: {color: colors.muted},
  total: {fontWeight: '800', color: colors.text, fontSize: 16},
});
