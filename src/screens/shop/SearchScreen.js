import React, {useMemo, useState} from 'react';
import {Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ProductImage from '../../components/shop/ProductImage';
import EmptyState from '../../components/shop/EmptyState';
import {CONCERNS, PRODUCTS, getCategory} from '../../data/catalog';
import {colors, formatPrice, spacing} from '../../theme';
import {isVoiceSearchAvailable, listen, matchProduct} from '../../utils/voiceSearch';

const POPULAR_SEARCHES = ['Joint pain', 'Hair oil', 'Diabetes', 'Kalonji', 'Vinegar', 'Gond'];

const matches = (product, q) => {
  const text = [
    product.name,
    product.ingredients,
    getCategory(product.category)?.name,
    ...product.concerns.map(c => CONCERNS.find(x => x.id === c)?.name),
  ]
    .join(' ')
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every(word => text.includes(word));
};

export default function SearchScreen({navigation, route}) {
  const [query, setQuery] = useState(route.params?.query || '');
  const q = query.trim();
  const results = useMemo(() => (q ? PRODUCTS.filter(p => matches(p, q)) : []), [q]);

  const onVoiceSearch = async () => {
    try {
      const phrases = await listen();
      if (phrases.length === 0) {
        return;
      }
      const product = matchProduct(phrases);
      if (product) {
        navigation.navigate('ProductDetail', {id: product.id});
      } else {
        setQuery(phrases[0]);
      }
    } catch (e) {
      Alert.alert('Voice search', e.message || 'Voice search is not available right now.');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => navigation.goBack()} accessibilityLabel="Back">
          <Icon name="arrow-left" size={22} color={colors.text} />
        </Pressable>
        <View style={styles.searchBox}>
          <Icon name="magnify" size={20} color={colors.muted} />
          <TextInput
            style={styles.input}
            placeholder="Search medicines, oils, concerns..."
            placeholderTextColor={colors.muted}
            autoFocus={!route.params?.query}
            returnKeyType="search"
            value={query}
            onChangeText={setQuery}
          />
          {!!query && (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
              <Icon name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          )}
          {isVoiceSearchAvailable && (
            <Pressable style={styles.micBtn} onPress={onVoiceSearch} hitSlop={8} accessibilityLabel="Voice search">
              <Icon name="microphone" size={20} color={colors.muted} />
            </Pressable>
          )}
        </View>
      </View>

      {!q ? (
        <View style={styles.suggestions}>
          <Text style={styles.suggestTitle}>Popular searches</Text>
          <View style={styles.chipWrap}>
            {POPULAR_SEARCHES.map(s => (
              <Pressable key={s} style={styles.chip} onPress={() => setQuery(s)}>
                <Icon name="trending-up" size={14} color={colors.primary} />
                <Text style={styles.chipText}>{s}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.suggestTitle, styles.suggestGap]}>Shop by concern</Text>
          <View style={styles.chipWrap}>
            {CONCERNS.map(c => (
              <Pressable
                key={c.id}
                style={styles.chip}
                onPress={() => navigation.replace('ProductList', {title: c.name, concern: c.id})}>
                <Icon name={c.icon} size={14} color={colors.primary} />
                <Text style={styles.chipText}>{c.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={item => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            results.length > 0 ? (
              <Text style={styles.count}>
                {results.length} results for “{q}”
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState icon="magnify-close" title="No results found" note={`We couldn't find anything for “${q}”.`} />
          }
          renderItem={({item}) => (
            <Pressable style={styles.row} onPress={() => navigation.navigate('ProductDetail', {id: item.id})}>
              <ProductImage uri={item.image} style={styles.thumb} iconSize={24} />
              <View style={styles.rowInfo}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.rowMeta}>
                  {item.size} · ★ {item.rating.toFixed(1)}
                </Text>
                <Text style={styles.rowPrice}>{formatPrice(item.price)}</Text>
              </View>
              <Icon name="chevron-right" size={22} color={colors.muted} />
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background},
  header: {flexDirection: 'row', alignItems: 'center', padding: spacing.sm, paddingRight: spacing.md},
  back: {width: 40, height: 40, alignItems: 'center', justifyContent: 'center'},
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 46,
    backgroundColor: colors.card,
  },
  input: {flex: 1, marginHorizontal: 8, color: colors.text, fontSize: 15},
  micBtn: {marginLeft: 10, paddingLeft: 10, borderLeftWidth: 1, borderLeftColor: colors.border},
  suggestions: {padding: spacing.md},
  suggestTitle: {fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 10},
  suggestGap: {marginTop: spacing.lg},
  chipWrap: {flexDirection: 'row', flexWrap: 'wrap'},
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginRight: 8,
    marginBottom: 8,
  },
  chipText: {marginLeft: 6, color: colors.text, fontSize: 13, fontWeight: '500'},
  list: {padding: spacing.md, flexGrow: 1},
  count: {color: colors.muted, fontSize: 12, marginBottom: spacing.sm},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  thumb: {width: 56, height: 56, borderRadius: 10},
  rowInfo: {flex: 1, marginLeft: 12},
  rowName: {fontWeight: '700', color: colors.text, fontSize: 14},
  rowMeta: {color: colors.muted, fontSize: 12, marginTop: 2},
  rowPrice: {color: colors.text, fontWeight: '800', marginTop: 4},
});
