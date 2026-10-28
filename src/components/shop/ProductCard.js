import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useCart} from '../../context/CartContext';
import {discountPercent} from '../../data/catalog';
import {colors, formatPrice} from '../../theme';
import ProductImage from './ProductImage';
import QuantityStepper from './QuantityStepper';

export default function ProductCard({product, onPress, style}) {
  const {getQty, setQty, addToCart, isWishlisted, toggleWishlist} = useCart();
  const qty = getQty(product.id);
  const off = discountPercent(product);
  const liked = isWishlisted(product.id);

  return (
    <Pressable style={[styles.card, style]} onPress={onPress}>
      <View style={styles.imageWrap}>
        <ProductImage uri={product.image} style={styles.image} />
        {off > 0 && (
          <View style={styles.offTag}>
            <Text style={styles.offTagText}>{off}% OFF</Text>
          </View>
        )}
        {!!product.badge && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{product.badge}</Text>
          </View>
        )}
        <Pressable
          style={styles.heart}
          onPress={() => toggleWishlist(product.id)}
          hitSlop={8}
          accessibilityLabel={liked ? 'Remove from wishlist' : 'Add to wishlist'}>
          <Icon name={liked ? 'heart' : 'heart-outline'} size={18} color={liked ? colors.danger : colors.muted} />
        </Pressable>
        {!product.inStock && (
          <View style={styles.soldOut}>
            <Text style={styles.soldOutText}>Sold out</Text>
          </View>
        )}
      </View>

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={2}>
          {product.name}
        </Text>
        <Text style={styles.size}>{product.size}</Text>
        <View style={styles.ratingRow}>
          {[1, 2, 3, 4, 5].map(i => (
            <Icon
              key={i}
              name={product.rating >= i ? 'star' : product.rating >= i - 0.5 ? 'star-half-full' : 'star-outline'}
              size={13}
              color={colors.star}
            />
          ))}
          <Text style={styles.reviews}>({product.reviews})</Text>
        </View>

        <View style={styles.spacer} />
        <View style={styles.priceRow}>
          <Text style={styles.price}>{formatPrice(product.price)}</Text>
          {off > 0 && <Text style={styles.mrp}>{formatPrice(product.mrp)}</Text>}
        </View>

        {!product.inStock ? (
          <View style={[styles.addBtn, styles.addBtnDisabled]}>
            <Text style={styles.addBtnTextDisabled}>Out of stock</Text>
          </View>
        ) : qty > 0 ? (
          <View style={styles.stepperWrap}>
            <QuantityStepper small qty={qty} onChange={n => setQty(product.id, n)} />
          </View>
        ) : (
          <Pressable style={styles.addBtn} onPress={() => addToCart(product.id)}>
            <Text style={styles.addBtnText}>Add to cart</Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  imageWrap: {height: 130, backgroundColor: colors.primaryLight},
  image: {width: '100%', height: '100%'},
  offTag: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: colors.primary,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  offTagText: {color: '#fff', fontSize: 10, fontWeight: '800'},
  badge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: '#FFF8E1',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#FFE082',
  },
  badgeText: {color: colors.offer, fontSize: 10, fontWeight: '700'},
  heart: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  soldOut: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  soldOutText: {
    backgroundColor: colors.text,
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  // info fills the card so price + button sit at the bottom and cards in a row line up
  info: {flex: 1, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10},
  name: {fontSize: 13, lineHeight: 17, fontWeight: '700', color: colors.text},
  size: {fontSize: 11, color: colors.muted, marginTop: 1},
  ratingRow: {flexDirection: 'row', alignItems: 'center', marginTop: 4},
  spacer: {flexGrow: 1},
  reviews: {fontSize: 11, color: colors.muted, marginLeft: 4},
  priceRow: {flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', marginTop: 4},
  price: {fontSize: 15, fontWeight: '800', color: colors.text, marginRight: 6},
  mrp: {fontSize: 11, color: colors.muted, textDecorationLine: 'line-through', marginRight: 6},
  addBtn: {
    marginTop: 8,
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: {color: '#fff', fontWeight: '700', fontSize: 13},
  addBtnDisabled: {backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border},
  addBtnTextDisabled: {color: colors.muted, fontWeight: '700', fontSize: 13},
  stepperWrap: {marginTop: 8, alignItems: 'center'},
});
