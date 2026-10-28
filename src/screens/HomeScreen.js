import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ProductCard from '../components/shop/ProductCard';
import ClinicLocator from '../components/ClinicLocator';
import { useCart } from '../context/CartContext';
import {
  isVoiceSearchAvailable,
  listen,
  matchProduct,
} from '../utils/voiceSearch';
import { BANNERS, CATEGORIES, CONCERNS, PRODUCTS } from '../data/catalog';
import { colors, spacing } from '../theme';

const ANNOUNCEMENTS = [
  '100% Ayurvedic & Unani Products',
  'Extra 5% off on app orders · Code: APP5',
  'Free delivery across India (4–7 days)',
];

const BEST_SELLER_TABS = [
  { id: 'all', name: 'Best Sellers' },
  ...['joint-pain', 'back-pain', 'hair', 'gut-health', 'skin', 'diabetes'].map(
    id => CONCERNS.find(c => c.id === id),
  ),
];

const productsForTab = tabId =>
  tabId === 'all'
    ? PRODUCTS.filter(p => p.bestseller)
    : PRODUCTS.filter(p => p.concerns.includes(tabId));
const FEATURED = PRODUCTS.filter(p => !p.bestseller && p.inStock).slice(0, 4);
const CAROUSEL_ITEMS = BANNERS;

const { width: SCREEN_WIDTH } = Dimensions.get('window');

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
    route: 'Explore',
  },
  {
    id: '4',
    title: 'Ask Expert',
    icon: require('../assets/icons/ask_expert.png'),
    route: 'Calls',
  },
];

export default function HomeScreen({ navigation }) {
  const { count } = useCart();
  const [activeIndex, setActiveIndex] = useState(0);
  const [announcementIndex, setAnnouncementIndex] = useState(0);
  const [bestSellerTab, setBestSellerTab] = useState('all');
  const scrollViewRef = useRef(null);
  const tabProducts = productsForTab(bestSellerTab);

  useEffect(() => {
    const timer = setInterval(
      () => setAnnouncementIndex(i => (i + 1) % ANNOUNCEMENTS.length),
      3000,
    );
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveIndex(prevIndex => {
        const nextIndex = (prevIndex + 1) % CAROUSEL_ITEMS.length;
        if (scrollViewRef.current) {
          scrollViewRef.current.scrollTo({
            x: nextIndex * (SCREEN_WIDTH - spacing.md * 2),
            animated: true,
          });
        }
        return nextIndex;
      });
    }, 4000);

    return () => clearInterval(timer);
  }, []);

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
      const product = matchProduct(phrases);
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
      <View style={styles.announcement}>
        <Text style={styles.announcementText} numberOfLines={1}>
          {ANNOUNCEMENTS[announcementIndex]}
        </Text>
      </View>
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
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Search Bar */}
        <View style={styles.searchRow}>
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

        {/* 3-Card Carousel Banner */}
        <View style={styles.carouselContainer}>
          <ScrollView
            ref={scrollViewRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={handleScroll}
            scrollEventThrottle={16}
          >
            {CAROUSEL_ITEMS.map(item => (
              <View
                key={item.id}
                style={[
                  styles.heroBanner,
                  { width: SCREEN_WIDTH - spacing.md * 2 },
                  item.gradient && { backgroundImage: item.gradient },
                ]}
              >
                <View style={styles.heroTextContainer}>
                  <Text style={styles.heroBadge}>{item.badge}</Text>
                  <Text style={styles.heroTitle}>{item.title}</Text>
                  <Pressable
                    style={styles.heroBtn}
                    onPress={() =>
                      navigation.navigate(
                        'ProductList',
                        item.concern
                          ? { title: item.badge, concern: item.concern }
                          : item.category
                          ? { title: item.badge, category: item.category }
                          : { title: 'All Products' },
                      )
                    }
                  >
                    <Text style={styles.heroBtnText}>Shop Now</Text>
                  </Pressable>
                </View>
                <Image
                  source={item.image}
                  style={styles.heroImage}
                  resizeMode="cover"
                />
              </View>
            ))}
          </ScrollView>

          {/* Pagination Dots */}
          <View style={styles.dotsContainer}>
            {CAROUSEL_ITEMS.map((_, index) => (
              <View
                key={index}
                style={[styles.dot, activeIndex === index && styles.activeDot]}
              />
            ))}
          </View>
        </View>

        {/* Quick Action Buttons */}
        <View style={styles.quickActionsRow}>
          {QUICK_ACTIONS.map(action => (
            <Pressable
              key={action.id}
              style={styles.quickActionButton}
              onPress={() => {
                if (action.route === 'Clinic') {
                  navigation.navigate('Clinic');
                } else if (action.route === 'Explore') {
                  navigation.navigate('Explore');
                } else if (action.route === 'Calls') {
                  navigation.navigate('Calls');
                } else {
                  Alert.alert(
                    action.title,
                    `${action.title} consultation feature coming soon.`,
                  );
                }
              }}
            >
              <View style={styles.quickActionIconContainer}>
                <Image
                  source={action.icon}
                  style={[
                    styles.quickActionIcon,
                    { tintColor: colors.primary },
                  ]}
                  resizeMode="contain"
                />
              </View>
              <Text style={styles.quickActionText} numberOfLines={1}>
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

        {/* Categories */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Categories</Text>
          <Pressable onPress={() => navigation.navigate('Explore')}>
            <Text style={styles.seeAll}>See All</Text>
          </Pressable>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.categoriesScroll}
        >
          {CATEGORIES.map(cat => (
            <Pressable
              key={cat.id}
              style={styles.categoryItem}
              onPress={() =>
                navigation.navigate('ProductList', {
                  title: cat.name,
                  category: cat.id,
                })
              }
            >
              <View style={styles.categoryCircle}>
                <Icon name={cat.icon} size={26} color={colors.primary} />
              </View>
              <Text style={styles.categoryText} numberOfLines={1}>
                {cat.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Shop by Concern */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Shop by Concern</Text>
        </View>
        <View style={styles.concernGrid}>
          {CONCERNS.map(c => (
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
              <View style={[styles.concernCircle, { backgroundColor: c.tint }]}>
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
                const tab = BEST_SELLER_TABS.find(t => t.id === bestSellerTab);
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
  scrollContent: { padding: spacing.md, paddingBottom: 120 },
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
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
  },
  headerLogo: { width: 84, height: 27 },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnSpacing: { marginLeft: 8 },
  headerIcon: { width: 20, height: 20 },
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
    marginBottom: spacing.md,
  },
  // Same size and look as the Sign-up screen's input fields
  searchContainer: {
    width: SCREEN_WIDTH - 80,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderWidth: 1.2,
    borderColor: '#C5CCC7',
    borderRadius: 30,
    paddingHorizontal: 20,
    height: 60,
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
  heroBanner: {
    // Fallback colour where gradients are unsupported
    backgroundColor: colors.primaryDark,
    backgroundImage: `linear-gradient(135deg, ${colors.primaryDark} 0%, ${colors.primary} 60%, #3FA36A 100%)`,
    borderRadius: 16,
    height: 200,
    padding: spacing.md,
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
    fontSize: 12,
    fontWeight: '700',
    color: '#FFD54F',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  heroTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: spacing.md,
  },
  heroBtn: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  heroBtnText: { color: '#1B4D3E', fontWeight: '700', fontSize: 14 },
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
  categoriesScroll: { marginBottom: spacing.lg },
  categoryItem: { alignItems: 'center', marginRight: 14, width: 72 },
  categoryCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryText: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  productsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  productCard: { width: '48.5%', marginBottom: 12 },
  bestSellerCard: { width: 160, marginRight: 12 },
  announcement: {
    backgroundColor: colors.primary,
    paddingVertical: 7,
    paddingHorizontal: spacing.md,
  },
  announcementText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
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
