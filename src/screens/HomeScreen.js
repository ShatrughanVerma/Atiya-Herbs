import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import CategoryMenu from '../components/shop/CategoryMenu';
import ProductCard from '../components/shop/ProductCard';
import ClinicLocator from '../components/ClinicLocator';
import { useCart } from '../context/CartContext';
import {
  isVoiceSearchAvailable,
  listen,
  matchProduct,
} from '../utils/voiceSearch';
import {
  CatalogUnavailable,
  OfflineBanner,
} from '../components/shop/CatalogStatus';
import { useCatalog } from '../context/CatalogContext';
import { colors, spacing } from '../theme';

const BEST_SELLER_CONCERNS = [
  'joint-pain',
  'back-pain',
  'hair',
  'gut-health',
  'skin',
  'diabetes',
];

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// Every carousel card has the same size: the width of the screen minus the side margins, and the height of the
// wide banner pictures (they are 1200 x 557). The older text-and-photo cards are made to fit the same height.
const CARD_WIDTH = SCREEN_WIDTH - spacing.md * 2;
const CARD_HEIGHT = Math.round(CARD_WIDTH / (1200 / 557));

const QUICK_ACTIONS = [
  {
    id: '1',
    title: 'Book Consult',
    icon: require('../assets/icons/consult.png'),
    route: 'Clinic',
  },
  {
    id: '2',
    title: 'Find Clinic',
    icon: require('../assets/icons/location.png'),
    route: 'Clinic',
  },
  {
    id: '3',
    title: 'Shop Ayurveda',
    icon: require('../assets/icons/shop_ayurveda.png'),
    route: 'Categories',
  },
  {
    id: '5',
    title: 'Health Wellness',
    iconName: 'heart-pulse',
    route: 'Wellness',
  },
  {
    id: '4',
    title: 'Ask Expert',
    icon: require('../assets/icons/ask_expert.png'),
    route: 'Calls',
  },
];

// A bundled picture that is already a finished wide banner (wider than 1.6 : 1, text and button included)
// The older banners are small product photos that sit beside the text, so they are not wide.
const isFullBanner = image => {
  const size = image && typeof image === 'number' ? Image.resolveAssetSource(image) : null;
  return !!size && size.width / size.height > 1.6;
};

export default function HomeScreen({ navigation }) {
  const { count, refreshCart, loggedIn } = useCart();
  // Everything about products comes from the server (or its saved copy); nothing is made up here
  const { ready, products, banners, categories, concerns, retry } = useCatalog();
  // Pull down to load the shop (and the cart of a logged-in person) again
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([retry(), loggedIn ? refreshCart() : null]);
    } finally {
      setRefreshing(false);
    }
  }, [retry, refreshCart, loggedIn]);
  const CAROUSEL_ITEMS = banners;
  const BEST_SELLER_TABS = [
    { id: 'all', name: 'Best Sellers' },
    ...BEST_SELLER_CONCERNS.map(id => concerns.find(c => c.id === id)).filter(
      Boolean,
    ),
  ];
  const FEATURED = products.filter(p => !p.bestseller && p.inStock).slice(0, 4);
  const [activeIndex, setActiveIndex] = useState(0);
  const [bestSellerTab, setBestSellerTab] = useState('all');
  const scrollViewRef = useRef(null);
  const tabProducts =
    bestSellerTab === 'all'
      ? products.filter(p => p.bestseller)
      : products.filter(p => p.concerns.includes(bestSellerTab));

  useEffect(() => {
    if (banners.length === 0) {
      return undefined;
    }
    const timer = setInterval(() => {
      setActiveIndex(prevIndex => {
        const nextIndex = (prevIndex + 1) % banners.length;
        if (scrollViewRef.current) {
          scrollViewRef.current.scrollTo({
            x: nextIndex * CARD_WIDTH,
            animated: true,
          });
        }
        return nextIndex;
      });
    }, 4000);

    return () => clearInterval(timer);
  }, [banners.length]);

  const onVoiceSearch = async () => {
    if (!isVoiceSearchAvailable) {
      navigation.navigate('Search');
      return;
    }
    try {
      const phrases = await listen();
      if (phrases.length === 0) {
        return; // cancelled or nothing heard
      }
      const product = matchProduct(phrases, products);
      if (product) {
        navigation.navigate('ProductDetail', { id: product.id });
      } else {
        navigation.navigate('Search', { query: phrases[0] });
      }
    } catch (e) {
      Alert.alert(
        'Voice search',
        e.message || 'Voice search is not available right now.',
      );
    }
  };

  const handleScroll = event => {
    const slideWidth = event.nativeEvent.layoutMeasurement.width;
    const offset = event.nativeEvent.contentOffset.x;
    const index = Math.round(offset / slideWidth);
    setActiveIndex(index);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Image
          source={require('../assets/images/logo.png')}
          style={styles.headerLogo}
          resizeMode="contain"
          accessibilityLabel="Atiya Herbs"
        />
        <View style={styles.headerRight}>
          <Pressable
            style={styles.iconBtn}
            onPress={() =>
              Alert.alert('Notifications', 'No new notifications.')
            }
          >
            <Image
              source={require('../assets/icons/notification.png')}
              style={[styles.headerIcon, { tintColor: colors.primary }]}
              resizeMode="contain"
            />
          </Pressable>
          <Pressable
            style={[styles.iconBtn, styles.iconBtnSpacing]}
            onPress={() => navigation.navigate('Cart')}
          >
            <Image
              source={require('../assets/icons/shopping-cart.png')}
              style={[styles.headerIcon, { tintColor: colors.primary }]}
              resizeMode="contain"
            />
            {count > 0 && (
              <View style={styles.cartBadge}>
                <Text style={styles.cartBadgeText}>
                  {count > 9 ? '9+' : count}
                </Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      >
        {/* Search Bar */}
        <View style={styles.searchRow}>
          {/* Category menu, to the left of the search bar */}
          <CategoryMenu
            size={40}
            categories={categories}
            counts={Object.fromEntries(categories.map(c => [c.id, products.filter(p => p.category === c.id).length]))}
            onSelect={cat => navigation.navigate('ProductList', { title: cat.name, category: cat.id })}
            onAll={() => navigation.navigate('ProductList', { title: 'All Products' })}
          />
          <Pressable
            style={styles.searchContainer}
            onPress={() => navigation.navigate('Search')}
          >
            <Image
              source={require('../assets/icons/search_icon.png')}
              style={[styles.searchIcon, { tintColor: colors.muted }]}
              resizeMode="contain"
            />
            <Text style={styles.searchPlaceholder} numberOfLines={1}>
              Search herbal medicines, oils, remedies...
            </Text>
            <Pressable
              style={styles.micBtn}
              onPress={onVoiceSearch}
              hitSlop={8}
              accessibilityLabel="Voice search"
            >
              <Image
                source={require('../assets/icons/mic.png')}
                style={styles.micIcon}
                resizeMode="contain"
              />
            </Pressable>
          </Pressable>
        </View>

        {/* Banners from the server */}
        {CAROUSEL_ITEMS.length > 0 && (
          <View style={styles.carouselContainer}>
            <ScrollView
              ref={scrollViewRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={handleScroll}
              scrollEventThrottle={16}
            >
              {CAROUSEL_ITEMS.map(item => {
                const open = () =>
                  navigation.navigate(
                    'ProductList',
                    item.concern
                      ? { title: item.badge, concern: item.concern }
                      : item.category
                      ? { title: item.badge, category: item.category }
                      : { title: 'All Products' },
                  );
                const full = isFullBanner(item.image);
                // A finished, wide banner picture (its text and "Shop Now" are part of the picture): show it alone
                if (full) {
                  return (
                    <Pressable
                      key={item.id}
                      onPress={open}
                      style={styles.fullBanner}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.badge ?? 'Offer'}: Shop Now`}
                    >
                      <Image
                        source={item.image}
                        style={styles.fullBannerImage}
                        resizeMode="cover"
                      />
                    </Pressable>
                  );
                }
                return (
                  <View
                    key={item.id}
                    style={[
                      styles.heroBanner,
                      item.gradient && { backgroundImage: item.gradient },
                    ]}
                  >
                    <View style={styles.heroTextContainer}>
                      <Text style={styles.heroBadge}>{item.badge}</Text>
                      <Text style={styles.heroTitle} numberOfLines={3}>
                        {item.title}
                      </Text>
                      <Pressable style={styles.heroBtn} onPress={open}>
                        <Text style={styles.heroBtnText}>Shop Now</Text>
                      </Pressable>
                    </View>
                    {!!item.image && (
                      <Image
                        source={item.image}
                        style={styles.heroImage}
                        resizeMode="cover"
                      />
                    )}
                  </View>
                );
              })}
            </ScrollView>

            {/* Pagination Dots */}
            <View style={styles.dotsContainer}>
              {CAROUSEL_ITEMS.map((_, index) => (
                <View
                  key={index}
                  style={[
                    styles.dot,
                    activeIndex === index && styles.activeDot,
                  ]}
                />
              ))}
            </View>
          </View>
        )}

        {/* Quick Action Buttons */}
        <View style={styles.quickActionsRow}>
          {QUICK_ACTIONS.map(action => (
            <Pressable
              key={action.id}
              style={styles.quickActionButton}
              onPress={() => {
                if (action.route === 'Clinic') {
                  navigation.navigate('Clinic');
                } else if (action.route === 'Categories') {
                  navigation.navigate('Categories');
                } else if (action.route === 'Calls') {
                  navigation.navigate('Calls');
                } else if (action.route === 'Wellness') {
                  navigation.navigate('Wellness');
                } else {
                  Alert.alert(
                    action.title,
                    `${action.title} consultation feature coming soon.`,
                  );
                }
              }}
            >
              <View style={styles.quickActionIconContainer}>
                {action.iconName ? (
                  <Icon name={action.iconName} size={26} color={colors.primary} />
                ) : (
                  <Image
                    source={action.icon}
                    style={[
                      styles.quickActionIcon,
                      { tintColor: colors.primary },
                    ]}
                    resizeMode="contain"
                  />
                )}
              </View>
              <Text style={styles.quickActionText} numberOfLines={2}>
                {action.title}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Ask an Expert / Health Quiz Banner */}
        <View style={styles.expertBanner}>
          <View style={styles.expertContent}>
            <Image
              source={require('../assets/icons/ask_expert.png')}
              style={styles.expertIcon}
              resizeMode="contain"
            />
            <View style={styles.expertTextContainer}>
              <Text style={styles.expertTitle}>Ask an Expert</Text>
              <Text style={styles.expertSubtitle}>
                Get advice or take the 4 step health quiz
              </Text>
            </View>
          </View>
          <Pressable
            style={styles.expertBtn}
            onPress={() =>
              Alert.alert(
                'Ask an Expert',
                'Health quiz & expert consultation coming soon.',
              )
            }
          >
            <Text style={styles.expertBtnText}>Start</Text>
          </Pressable>
        </View>

        {/* Find a Clinic Near You Banner */}
        <View style={[styles.expertBanner, styles.clinicBanner]}>
          <View style={styles.expertContent}>
            <Image
              source={require('../assets/icons/location.png')}
              style={styles.expertIcon}
              resizeMode="contain"
            />
            <View style={styles.expertTextContainer}>
              <Text style={styles.expertTitle}>Find a clinic near you</Text>
              <Text style={styles.expertSubtitle}>
                Visit Hakim Suleman's clinic and book an appointment
              </Text>
            </View>
          </View>
          <Pressable
            style={styles.expertBtn}
            onPress={() => navigation.navigate('Clinic')}
          >
            <Text style={styles.expertBtnText}>Visit</Text>
          </Pressable>
        </View>

        {ready ? (
          <>
            {/* Shop by Concern */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Shop by Concern</Text>
            </View>
            <View style={styles.concernGrid}>
              {concerns.map(c => (
                <Pressable
                  key={c.id}
                  style={styles.concernItem}
                  onPress={() =>
                    navigation.navigate('ProductList', {
                      title: c.name,
                      concern: c.id,
                    })
                  }
                >
                  <View
                    style={[styles.concernCircle, { backgroundColor: c.tint }]}
                  >
                    <Icon name={c.icon} size={28} color={colors.primary} />
                  </View>
                  <Text style={styles.concernText} numberOfLines={1}>
                    {c.name}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Best Sellers with concern tabs */}
            <View style={styles.band}>
              <View style={styles.bandHeader}>
                <Text style={styles.bandTitle}>Our Best Sellers</Text>
                <Pressable
                  onPress={() => {
                    const tab = BEST_SELLER_TABS.find(
                      t => t.id === bestSellerTab,
                    );
                    navigation.navigate(
                      'ProductList',
                      tab.id === 'all'
                        ? { title: 'Best Sellers', bestseller: true }
                        : { title: tab.name, concern: tab.id },
                    );
                  }}
                >
                  <Text style={styles.seeAll}>View All</Text>
                </Pressable>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tabs}
              >
                {BEST_SELLER_TABS.map(tab => {
                  const active = tab.id === bestSellerTab;
                  return (
                    <Pressable
                      key={tab.id}
                      style={[styles.tab, active && styles.tabActive]}
                      onPress={() => setBestSellerTab(tab.id)}
                    >
                      <Text
                        style={[styles.tabText, active && styles.tabTextActive]}
                      >
                        {tab.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.bandProducts}
              >
                {tabProducts.map(product => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    style={styles.bestSellerCard}
                    onPress={() =>
                      navigation.navigate('ProductDetail', { id: product.id })
                    }
                  />
                ))}
              </ScrollView>
            </View>

            {/* Featured Products */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Featured Products</Text>
              <Pressable
                onPress={() =>
                  navigation.navigate('ProductList', { title: 'All Products' })
                }
              >
                <Text style={styles.seeAll}>See All</Text>
              </Pressable>
            </View>

            <View style={styles.productsGrid}>
              {FEATURED.map(product => (
                <ProductCard
                  key={product.id}
                  product={product}
                  style={styles.productCard}
                  onPress={() =>
                    navigation.navigate('ProductDetail', { id: product.id })
                  }
                />
              ))}
            </View>
          </>
        ) : (
          <CatalogUnavailable compact />
        )}

        {/* Brand legacy */}
        <View style={styles.legacy}>
          <Icon name="leaf" size={28} color="#A5D6A7" />
          <Text style={styles.legacyTitle}>
            The legacy of Hakim Suleman Khan
          </Text>
          <Text style={styles.legacyText}>
            Traditional Unani and Ayurvedic remedies, prepared with pure herbs
            and trusted by families across India.
          </Text>
          <View style={styles.legacyStats}>
            {[
              ['100%', 'Herbal'],
              ['Unani', '& Ayurveda'],
              ['Free', 'Delivery'],
            ].map(([value, label]) => (
              <View key={label} style={styles.legacyStat}>
                <Text style={styles.legacyValue}>{value}</Text>
                <Text style={styles.legacyLabel}>{label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Trust Badges Footer */}
        <View style={styles.trustContainer}>
          <View style={styles.trustItem}>
            <Icon
              name="shield-check-outline"
              size={28}
              color={colors.primary}
            />
            <Text style={styles.trustTitle}>100% Genuine</Text>
            <Text style={styles.trustSub}>Authentic herbs</Text>
          </View>
          <View style={styles.trustItem}>
            <Icon name="truck-fast-outline" size={28} color={colors.primary} />
            <Text style={styles.trustTitle}>Fast Delivery</Text>
            <Text style={styles.trustSub}>Safe shipping</Text>
          </View>
          <View style={styles.trustItem}>
            <Icon name="leaf-circle-outline" size={28} color={colors.primary} />
            <Text style={styles.trustTitle}>Pure & Natural</Text>
            <Text style={styles.trustSub}>Zero side effects</Text>
          </View>
        </View>
      </ScrollView>
      <ClinicLocator style={styles.clinicLocator} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  // Extra bottom space so the floating clinic card never hides the last section
  scrollContent: { paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: 120 },
  clinicLocator: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    bottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.background,
  },
  headerLogo: { width: 84, height: 27 },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnSpacing: { marginLeft: 8 },
  headerIcon: { width: 18, height: 18 },
  cartBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  cartBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  // Same look as the Sign-up screen's input fields, a little lower to keep the top of the screen compact
  searchContainer: {
    width: SCREEN_WIDTH - 32 - 44, // the menu button (40) and a gap (4) sit on its left
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderWidth: 1.2,
    borderColor: '#C5CCC7',
    borderRadius: 24,
    paddingHorizontal: 16,
    height: 46,
  },
  searchIcon: { width: 20, height: 20, marginRight: 10 },
  searchPlaceholder: {
    flex: 1,
    fontFamily: 'Poppins-Regular',
    color: '#8A938D',
    fontSize: 15,
  },
  micBtn: {
    paddingLeft: 10,
    marginLeft: 8,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    height: 24,
    justifyContent: 'center',
  },
  micIcon: { width: 20, height: 20, tintColor: colors.muted },
  carouselContainer: { marginBottom: spacing.md },
  fullBanner: { width: CARD_WIDTH, height: CARD_HEIGHT, borderRadius: 16, overflow: 'hidden' },
  fullBannerImage: { width: '100%', height: '100%' },
  heroBanner: {
    // Fallback colour where gradients are unsupported
    backgroundColor: colors.primaryDark,
    backgroundImage: `linear-gradient(135deg, ${colors.primaryDark} 0%, ${colors.primary} 60%, #3FA36A 100%)`,
    borderRadius: 16,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    padding: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  heroImage: {
    width: '44%',
    height: '100%',
    borderRadius: 12,
    marginLeft: spacing.sm,
  },
  heroTextContainer: { flex: 1, paddingRight: spacing.xs },
  heroBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFD54F',
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  heroTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: spacing.sm,
  },
  heroBtn: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  heroBtnText: { color: '#1B4D3E', fontWeight: '700', fontSize: 13 },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginHorizontal: 4,
  },
  activeDot: { width: 20, backgroundColor: colors.primary },
  quickActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  quickActionButton: { alignItems: 'center', flex: 1, marginHorizontal: 4 },
  quickActionIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 6,
  },
  quickActionIcon: { width: 24, height: 24 },
  quickActionText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  expertBanner: {
    backgroundColor: '#E8F5E9',
    borderRadius: 16,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#dcdfdc',
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  clinicBanner: {
    backgroundColor: '#FFF8E7',
    borderColor: '#F0E6CC',
  },
  expertContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  expertIcon: {
    width: 32,
    height: 32,
    marginRight: 12,
    tintColor: colors.primary,
  },
  expertTextContainer: { flex: 1 },
  expertTitle: { fontSize: 13, fontWeight: '700', color: colors.primary },
  expertSubtitle: { fontSize: 11, color: colors.muted, marginTop: 2 },
  expertBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
  },
  expertBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  seeAll: { fontSize: 13, fontWeight: '600', color: colors.primary },
  productsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  productCard: { width: '48.5%', marginBottom: 12 },
  bestSellerCard: { width: 160, marginRight: 12 },
  concernGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: spacing.sm,
  },
  concernItem: { width: '25%', alignItems: 'center', marginBottom: spacing.md },
  concernCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  concernText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
    marginTop: 6,
  },
  band: {
    backgroundColor: colors.primaryLight,
    marginHorizontal: -spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
  },
  bandHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  bandTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
  tabs: { paddingHorizontal: spacing.md, paddingBottom: 12 },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.background,
    marginRight: 8,
  },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  tabTextActive: { color: '#fff' },
  bandProducts: { paddingHorizontal: spacing.md },
  legacy: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    padding: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  legacyTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 8,
  },
  legacyText: {
    color: '#D7F0E0',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 19,
  },
  legacyStats: {
    flexDirection: 'row',
    marginTop: spacing.md,
    alignSelf: 'stretch',
  },
  legacyStat: { flex: 1, alignItems: 'center' },
  legacyValue: { color: '#fff', fontSize: 18, fontWeight: '800' },
  legacyLabel: { color: '#D7F0E0', fontSize: 11, marginTop: 2 },
  trustContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  trustItem: { alignItems: 'center', flex: 1 },
  trustTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
    marginTop: 6,
  },
  trustSub: { fontSize: 10, color: colors.muted, marginTop: 2 },
});
