import React, {useState} from 'react';
import {Image, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import FilterSheet from '../components/shop/FilterSheet';
import {CATEGORIES, CONCERNS, PRODUCTS} from '../data/catalog';
import {colors, spacing} from '../theme';

export default function ExploreScreen({navigation}) {
  const [filterOpen, setFilterOpen] = useState(false);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Explore</Text>

        <View style={styles.searchRow}>
          <Pressable style={styles.search} onPress={() => navigation.navigate('Search')}>
            <Icon name="magnify" size={20} color={colors.muted} />
            <Text style={styles.searchText} numberOfLines={1}>
              Search medicines, oils, concerns...
            </Text>
          </Pressable>
          <Pressable style={styles.filterBtn} onPress={() => setFilterOpen(true)} accessibilityLabel="Filter and sort">
            <Image source={require('../assets/icons/filter.png')} style={styles.filterIcon} resizeMode="contain" />
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>Shop by Concern</Text>
        <View style={styles.grid}>
          {CONCERNS.map(c => (
            <Pressable
              key={c.id}
              style={styles.concern}
              onPress={() => navigation.navigate('ProductList', {title: c.name, concern: c.id})}>
              <View style={[styles.concernCircle, {backgroundColor: c.tint}]}>
                <Icon name={c.icon} size={28} color={colors.primary} />
              </View>
              <Text style={styles.concernText} numberOfLines={1}>
                {c.name}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Categories</Text>
        {CATEGORIES.map(cat => {
          const count = PRODUCTS.filter(p => p.category === cat.id).length;
          return (
            <Pressable
              key={cat.id}
              style={styles.catRow}
              onPress={() => navigation.navigate('ProductList', {title: cat.name, category: cat.id})}>
              <View style={styles.catIcon}>
                <Icon name={cat.icon} size={22} color={colors.primary} />
              </View>
              <View style={styles.catInfo}>
                <Text style={styles.catName}>{cat.name}</Text>
                <Text style={styles.catCount}>{count} products</Text>
              </View>
              <Icon name="chevron-right" size={22} color={colors.muted} />
            </Pressable>
          );
        })}

        <Pressable
          style={styles.allBtn}
          onPress={() => navigation.navigate('ProductList', {title: 'All Products'})}>
          <Text style={styles.allText}>View all products</Text>
          <Icon name="arrow-right" size={18} color={colors.primary} />
        </Pressable>
      </ScrollView>
      <FilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        onApply={filters => {
          setFilterOpen(false);
          navigation.navigate('ProductList', {title: 'All Products', filters});
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background},
  scroll: {padding: spacing.md, paddingBottom: 40},
  title: {fontSize: 26, fontWeight: '800', color: colors.text, marginBottom: spacing.md},
  searchRow: {flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg},
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
    backgroundColor: colors.card,
  },
  searchText: {flex: 1, marginLeft: 8, color: colors.muted, fontSize: 15},
  filterBtn: {width: 44, height: 48, marginLeft: 6, alignItems: 'center', justifyContent: 'center'},
  filterIcon: {width: 24, height: 24, tintColor: colors.primary},
  sectionTitle: {fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 12},
  grid: {flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md},
  concern: {width: '25%', alignItems: 'center', marginBottom: spacing.md},
  concernCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  concernText: {fontSize: 12, fontWeight: '600', color: colors.text, marginTop: 6},
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    marginBottom: 10,
  },
  catIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catInfo: {flex: 1, marginLeft: 12},
  catName: {fontWeight: '700', color: colors.text, fontSize: 15},
  catCount: {color: colors.muted, fontSize: 12, marginTop: 2},
  allBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    marginTop: 4,
  },
  allText: {color: colors.primary, fontWeight: '800', marginRight: 6, fontSize: 15},
});
