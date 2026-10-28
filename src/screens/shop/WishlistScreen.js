import React from 'react';
import {FlatList, StyleSheet} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import EmptyState from '../../components/shop/EmptyState';
import ProductCard from '../../components/shop/ProductCard';
import ScreenHeader from '../../components/shop/ScreenHeader';
import {useCart} from '../../context/CartContext';
import {getProduct} from '../../data/catalog';
import {colors, spacing} from '../../theme';

export default function WishlistScreen({navigation}) {
  const {wishlist} = useCart();
  const products = wishlist.map(getProduct).filter(Boolean);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader title="My Wishlist" navigation={navigation} showCart />
      <FlatList
        data={products}
        keyExtractor={p => p.id}
        numColumns={2}
        columnWrapperStyle={styles.column}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState
            icon="heart-outline"
            title="Your wishlist is empty"
            note="Tap the heart on any product to save it for later."
            actionLabel="Explore products"
            onAction={() => navigation.navigate('ProductList', {title: 'All Products'})}
          />
        }
        renderItem={({item}) => (
          <ProductCard
            product={item}
            style={styles.card}
            onPress={() => navigation.navigate('ProductDetail', {id: item.id})}
          />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background},
  list: {padding: spacing.md, flexGrow: 1},
  column: {justifyContent: 'space-between'},
  card: {width: '48.5%', marginBottom: 12},
});
