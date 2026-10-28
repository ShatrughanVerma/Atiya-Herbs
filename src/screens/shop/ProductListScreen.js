import React, {useMemo, useState} from 'react';
import {FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import ProductCard from '../../components/shop/ProductCard';
import ScreenHeader from '../../components/shop/ScreenHeader';
import EmptyState from '../../components/shop/EmptyState';
import FilterSheet from '../../components/shop/FilterSheet';
import {PRODUCTS} from '../../data/catalog';
import {colors, spacing} from '../../theme';
import {
  DEFAULT_FILTERS,
  SORT_OPTIONS,
  applyFilters,
  countActiveFilters,
} from '../../utils/productFilters';

// route.params: {title, category?, concern?, bestseller?, filters?}
export default function ProductListScreen({navigation, route}) {
  const {title = 'All Products', category, concern, bestseller} = route.params || {};
  const [filters, setFilters] = useState(route.params?.filters || DEFAULT_FILTERS);
  const [sheetOpen, setSheetOpen] = useState(false);

  // The page's own category/concern/best-seller scope; the sheet filters within it
  const baseProducts = useMemo(
    () =>
      PRODUCTS.filter(
        p =>
          (!category || p.category === category) &&
          (!concern || p.concerns.includes(concern)) &&
          (!bestseller || p.bestseller),
      ),
    [category, concern, bestseller],
  );
  const products = useMemo(() => applyFilters(baseProducts, filters), [baseProducts, filters]);
  const activeCount = countActiveFilters(filters);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader title={title} navigation={navigation} showCart />

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Pressable
            style={[styles.chip, styles.filterChip, activeCount > 0 && styles.filterChipActive]}
            onPress={() => setSheetOpen(true)}
            accessibilityLabel="Filter and sort">
            <Image source={require('../../assets/icons/filter.png')} style={styles.filterIcon} />
            <Text style={[styles.chipText, styles.filterText]}>Filter</Text>
            {activeCount > 0 && (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>{activeCount}</Text>
              </View>
            )}
          </Pressable>
          {SORT_OPTIONS.map(s => (
            <Pressable
              key={s.id}
              style={[styles.chip, filters.sort === s.id && styles.chipActive]}
              onPress={() => setFilters(f => ({...f, sort: s.id}))}>
              <Text style={[styles.chipText, filters.sort === s.id && styles.chipTextActive]}>{s.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={products}
        keyExtractor={item => item.id}
        numColumns={2}
        columnWrapperStyle={styles.column}
        contentContainerStyle={styles.list}
        ListHeaderComponent={<Text style={styles.count}>{products.length} products</Text>}
        ListEmptyComponent={
          <EmptyState
            icon="leaf-off"
            title="No matching products"
            note="Try removing a filter or browse all products."
            actionLabel={activeCount > 0 ? 'Clear filters' : 'Browse all'}
            onAction={() =>
              activeCount > 0
                ? setFilters(f => ({...DEFAULT_FILTERS, sort: f.sort}))
                : navigation.replace('ProductList', {title: 'All Products'})
            }
          />
        }
        renderItem={({item}) => (
          <ProductCard
            product={item}
            style={styles.card}
            onPress={() => navigation.push('ProductDetail', {id: item.id})}
          />
        )}
      />

      <FilterSheet
        visible={sheetOpen}
        initial={filters}
        baseProducts={baseProducts}
        onClose={() => setSheetOpen(false)}
        onApply={f => {
          setFilters(f);
          setSheetOpen(false);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background},
  chips: {paddingHorizontal: spacing.md, paddingVertical: 10},
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    marginRight: 8,
  },
  chipActive: {backgroundColor: colors.primary, borderColor: colors.primary},
  chipText: {fontSize: 12, fontWeight: '600', color: colors.text},
  chipTextActive: {color: '#fff'},
  filterChip: {flexDirection: 'row', alignItems: 'center', borderColor: colors.primary},
  filterChipActive: {backgroundColor: colors.primaryLight},
  filterIcon: {width: 14, height: 14, tintColor: colors.primary, marginRight: 6},
  filterText: {color: colors.primary, fontWeight: '700'},
  filterBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
    paddingHorizontal: 4,
  },
  filterBadgeText: {color: '#fff', fontSize: 10, fontWeight: '800'},
  list: {paddingHorizontal: spacing.md, paddingBottom: 40, flexGrow: 1},
  count: {fontSize: 12, color: colors.muted, marginBottom: spacing.sm},
  column: {justifyContent: 'space-between'},
  card: {width: '48.5%', marginBottom: 12},
});
