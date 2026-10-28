import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useCart} from '../../context/CartContext';
import {colors, spacing} from '../../theme';

export default function ScreenHeader({title, navigation, showCart = false, right}) {
  const {count} = useCart();
  return (
    <View style={styles.header}>
      {navigation.canGoBack() ? (
        <Pressable style={styles.iconBtn} onPress={() => navigation.goBack()} hitSlop={8} accessibilityLabel="Back">
          <Icon name="arrow-left" size={22} color={colors.text} />
        </Pressable>
      ) : (
        <View style={styles.spacer} />
      )}
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {right ||
        (showCart ? (
          <Pressable style={styles.iconBtn} onPress={() => navigation.navigate('Main', {screen: 'Cart'})} accessibilityLabel="Cart">
            <Icon name="cart-outline" size={22} color={colors.text} />
            {count > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{count > 9 ? '9+' : count}</Text>
              </View>
            )}
          </Pressable>
        ) : (
          <View style={styles.spacer} />
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    height: 56,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  iconBtn: {width: 40, height: 40, alignItems: 'center', justifyContent: 'center'},
  spacer: {width: 40},
  title: {flex: 1, fontSize: 17, fontWeight: '700', color: colors.text, marginHorizontal: 4},
  badge: {
    position: 'absolute',
    top: 4,
    right: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {color: '#fff', fontSize: 10, fontWeight: '800'},
});
