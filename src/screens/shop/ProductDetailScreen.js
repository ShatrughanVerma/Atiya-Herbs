import React, {useState} from 'react';
import {
  Dimensions,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ProductCard from '../../components/shop/ProductCard';
import ProductImage from '../../components/shop/ProductImage';
import QuantityStepper from '../../components/shop/QuantityStepper';
import {useCart} from '../../context/CartContext';
import {PRODUCTS, discountPercent, getProduct} from '../../data/catalog';
import {colors, formatPrice, spacing} from '../../theme';

const {width: SCREEN_WIDTH} = Dimensions.get('window');

function Section({title, children, initiallyOpen = false}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={styles.section}>
      <Pressable style={styles.sectionHead} onPress={() => setOpen(o => !o)}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={22} color={colors.muted} />
      </Pressable>
      {open && <View style={styles.sectionBody}>{children}</View>}
    </View>
  );
}

export default function ProductDetailScreen({navigation, route}) {
  const product = getProduct(route.params.id);
  const {getQty, setQty, addToCart, isWishlisted, toggleWishlist, count} = useCart();
  const [pincode, setPincode] = useState('');
  const [delivery, setDelivery] = useState(null);

  if (!product) {
    return null;
  }

  const qty = getQty(product.id);
  const off = discountPercent(product);
  const liked = isWishlisted(product.id);
  const related = PRODUCTS.filter(
    p => p.id !== product.id && p.concerns.some(c => product.concerns.includes(c)),
  ).slice(0, 6);

  const checkPincode = () => {
    // TODO: replace with the courier serviceability API
    setDelivery(/^[1-9][0-9]{5}$/.test(pincode) ? 'ok' : 'invalid');
  };

  const buyNow = () => {
    if (qty === 0) {
      addToCart(product.id);
    }
    navigation.navigate('Checkout');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View>
          <ProductImage uri={product.image} style={styles.hero} iconSize={80} />
          <View style={styles.topBar}>
            <Pressable style={styles.roundBtn} onPress={() => navigation.goBack()} accessibilityLabel="Back">
              <Icon name="arrow-left" size={22} color={colors.text} />
            </Pressable>
            <View style={styles.topRight}>
              <Pressable
                style={styles.roundBtn}
                onPress={() => Share.share({message: `${product.name} – Atiya Herbs`})}
                accessibilityLabel="Share">
                <Icon name="share-variant-outline" size={20} color={colors.text} />
              </Pressable>
              <Pressable
                style={[styles.roundBtn, styles.roundBtnSpacing]}
                onPress={() => toggleWishlist(product.id)}
                accessibilityLabel="Wishlist">
                <Icon name={liked ? 'heart' : 'heart-outline'} size={20} color={liked ? colors.danger : colors.text} />
              </Pressable>
              <Pressable
                style={[styles.roundBtn, styles.roundBtnSpacing]}
                onPress={() => navigation.navigate('Main', {screen: 'Cart'})}
                accessibilityLabel="Cart">
                <Icon name="cart-outline" size={20} color={colors.text} />
                {count > 0 && (
                  <View style={styles.cartBadge}>
                    <Text style={styles.cartBadgeText}>{count > 9 ? '9+' : count}</Text>
                  </View>
                )}
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.body}>
          {!!product.badge && <Text style={styles.badge}>{product.badge}</Text>}
          <Text style={styles.name}>{product.name}</Text>
          <Text style={styles.size}>{product.size}</Text>

          <View style={styles.ratingRow}>
            <View style={styles.ratingPill}>
              <Text style={styles.ratingText}>{product.rating.toFixed(1)}</Text>
              <Icon name="star" size={12} color="#fff" />
            </View>
            <Text style={styles.reviews}>{product.reviews} reviews</Text>
          </View>

          <View style={styles.priceRow}>
            <Text style={styles.price}>{formatPrice(product.price)}</Text>
            {off > 0 && <Text style={styles.mrp}>MRP {formatPrice(product.mrp)}</Text>}
            {off > 0 && (
              <View style={styles.offPill}>
                <Text style={styles.offText}>{off}% OFF</Text>
              </View>
            )}
          </View>
          <Text style={styles.tax}>Inclusive of all taxes</Text>

          <View style={styles.offerStrip}>
            <Icon name="tag-outline" size={18} color={colors.offer} />
            <Text style={styles.offerText}>
              Use code <Text style={styles.offerCode}>APP5</Text> for an extra 5% off on app orders
            </Text>
          </View>

          <View style={styles.deliveryBox}>
            <Text style={styles.boxTitle}>Check delivery</Text>
            <View style={styles.pinRow}>
              <Icon name="map-marker-outline" size={20} color={colors.muted} />
              <TextInput
                style={styles.pinInput}
                placeholder="Enter pincode"
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
                maxLength={6}
                value={pincode}
                onChangeText={t => {
                  setPincode(t.replace(/[^0-9]/g, ''));
                  setDelivery(null);
                }}
              />
              <Pressable onPress={checkPincode} hitSlop={8}>
                <Text style={styles.pinCheck}>Check</Text>
              </Pressable>
            </View>
            {delivery === 'ok' && (
              <Text style={styles.deliveryOk}>✓ Free delivery in 4–7 days · Cash on Delivery available</Text>
            )}
            {delivery === 'invalid' && <Text style={styles.deliveryErr}>Please enter a valid 6-digit pincode</Text>}
          </View>

          <View style={styles.trustRow}>
            {[
              ['shield-check-outline', '100% Genuine'],
              ['truck-fast-outline', 'Free Delivery'],
              ['cash', 'COD Available'],
              ['leaf-circle-outline', 'Herbal'],
            ].map(([icon, label]) => (
              <View key={label} style={styles.trustItem}>
                <View style={styles.trustCircle}>
                  <Icon name={icon} size={22} color={colors.primary} />
                </View>
                <Text style={styles.trustText}>{label}</Text>
              </View>
            ))}
          </View>

          <Section title="Description" initiallyOpen>
            <Text style={styles.paragraph}>{product.description}</Text>
          </Section>
          <Section title="Key Benefits" initiallyOpen>
            {product.benefits.map(b => (
              <View key={b} style={styles.bulletRow}>
                <Icon name="check-circle" size={16} color={colors.primary} />
                <Text style={styles.bulletText}>{b}</Text>
              </View>
            ))}
          </Section>
          <Section title="How to Use">
            <Text style={styles.paragraph}>{product.howToUse}</Text>
          </Section>
          <Section title="Ingredients">
            <Text style={styles.paragraph}>{product.ingredients}</Text>
          </Section>

          <Text style={styles.disclaimer}>
            This product is not intended to diagnose, treat, cure or prevent any disease. Please consult a doctor
            before use if you are pregnant, nursing or taking other medicines.
          </Text>
        </View>

        {related.length > 0 && (
          <View style={styles.related}>
            <Text style={styles.relatedTitle}>You may also like</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.relatedList}>
              {related.map(p => (
                <ProductCard
                  key={p.id}
                  product={p}
                  style={styles.relatedCard}
                  onPress={() => navigation.push('ProductDetail', {id: p.id})}
                />
              ))}
            </ScrollView>
          </View>
        )}
      </ScrollView>

      <View style={styles.bottomBar}>
        {!product.inStock ? (
          <View style={[styles.bigBtn, styles.bigBtnDisabled]}>
            <Text style={styles.bigBtnTextDisabled}>Currently out of stock</Text>
          </View>
        ) : (
          <>
            {qty > 0 ? (
              <View style={styles.stepperBox}>
                <QuantityStepper qty={qty} onChange={n => setQty(product.id, n)} />
              </View>
            ) : (
              <Pressable style={[styles.bigBtn, styles.outlineBtn]} onPress={() => addToCart(product.id)}>
                <Icon name="cart-plus" size={20} color={colors.accent} />
                <Text style={[styles.bigBtnText, styles.outlineBtnText]}>Add to Cart</Text>
              </Pressable>
            )}
            <Pressable style={[styles.bigBtn, styles.buyBtn]} onPress={buyNow}>
              <Text style={styles.bigBtnText}>Buy Now</Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background},
  scroll: {paddingBottom: spacing.lg},
  hero: {width: SCREEN_WIDTH, height: SCREEN_WIDTH * 0.9},
  topBar: {
    position: 'absolute',
    top: 10,
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  topRight: {flexDirection: 'row'},
  roundBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },
  roundBtnSpacing: {marginLeft: 8},
  cartBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  cartBadgeText: {color: '#fff', fontSize: 10, fontWeight: '800'},
  body: {
    padding: spacing.md,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -24,
    backgroundColor: colors.background,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFF8E1',
    color: colors.offer,
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    marginBottom: 8,
    overflow: 'hidden',
  },
  name: {fontSize: 22, fontWeight: '800', color: colors.text},
  size: {fontSize: 13, color: colors.muted, marginTop: 4},
  ratingRow: {flexDirection: 'row', alignItems: 'center', marginTop: 10},
  ratingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  ratingText: {color: '#fff', fontWeight: '700', fontSize: 12, marginRight: 2},
  reviews: {marginLeft: 8, color: colors.muted, fontSize: 13},
  priceRow: {flexDirection: 'row', alignItems: 'center', marginTop: 14},
  price: {fontSize: 26, fontWeight: '800', color: colors.text, marginRight: 10},
  mrp: {fontSize: 14, color: colors.muted, textDecorationLine: 'line-through', marginRight: 10},
  offPill: {backgroundColor: colors.primaryLight, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2},
  offText: {color: colors.primary, fontWeight: '800', fontSize: 12},
  tax: {fontSize: 11, color: colors.muted, marginTop: 2},
  offerStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cream,
    borderWidth: 1,
    borderColor: colors.creamBorder,
    borderStyle: 'dashed',
    borderRadius: 10,
    padding: 12,
    marginTop: spacing.md,
  },
  offerText: {flex: 1, marginLeft: 8, fontSize: 13, color: colors.text},
  offerCode: {fontWeight: '800', color: colors.offer},
  deliveryBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    marginTop: spacing.md,
  },
  boxTitle: {fontWeight: '700', color: colors.text, marginBottom: 8},
  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 44,
  },
  pinInput: {flex: 1, marginHorizontal: 8, color: colors.text, fontSize: 15},
  pinCheck: {color: colors.primary, fontWeight: '800'},
  deliveryOk: {color: colors.primary, marginTop: 8, fontSize: 12, fontWeight: '600'},
  deliveryErr: {color: colors.danger, marginTop: 8, fontSize: 12},
  trustRow: {flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md, marginBottom: spacing.sm},
  trustItem: {alignItems: 'center', flex: 1},
  trustCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trustText: {fontSize: 11, color: colors.text, marginTop: 6, fontWeight: '600', textAlign: 'center'},
  section: {borderBottomWidth: 1, borderBottomColor: colors.border},
  sectionHead: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14},
  sectionTitle: {fontSize: 16, fontWeight: '700', color: colors.text},
  sectionBody: {paddingBottom: 14},
  paragraph: {color: colors.text, lineHeight: 21, fontSize: 14},
  bulletRow: {flexDirection: 'row', alignItems: 'center', marginBottom: 8},
  bulletText: {marginLeft: 8, color: colors.text, fontSize: 14, flex: 1},
  disclaimer: {fontSize: 11, color: colors.muted, marginTop: spacing.md, lineHeight: 16},
  related: {marginTop: spacing.sm},
  relatedTitle: {fontSize: 18, fontWeight: '700', color: colors.text, marginHorizontal: spacing.md, marginBottom: 10},
  relatedList: {paddingHorizontal: spacing.md},
  relatedCard: {width: 160, marginRight: 12},
  bottomBar: {
    flexDirection: 'row',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  bigBtn: {
    flex: 1,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  outlineBtn: {borderWidth: 1.5, borderColor: colors.accent, marginRight: 10},
  outlineBtnText: {color: colors.accent, marginLeft: 6},
  buyBtn: {backgroundColor: colors.accent},
  bigBtnText: {color: '#fff', fontWeight: '800', fontSize: 16},
  bigBtnDisabled: {backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border},
  bigBtnTextDisabled: {color: colors.muted, fontWeight: '700', fontSize: 15},
  stepperBox: {flex: 1, alignItems: 'center', justifyContent: 'center', marginRight: 10},
});
