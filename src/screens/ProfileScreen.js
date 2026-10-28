import React from 'react';
import {Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useAuth} from '../context/AuthContext';
import {useCart} from '../context/CartContext';
import {CONTACT, PAGES, SOCIAL} from '../data/store';
import {colors, spacing} from '../theme';
import {chooseProfilePhoto} from '../utils/profilePhoto';

const openLink = url =>
  Linking.openURL(url).catch(() => Alert.alert('Could not open', 'Please try again later.'));

function MenuSection({title, items}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.menu}>
        {items.map((item, i) => (
          <Pressable
            key={item.label}
            style={({pressed}) => [
              styles.menuRow,
              i < items.length - 1 && styles.menuDivider,
              pressed && styles.menuPressed,
            ]}
            onPress={item.onPress}>
            <View style={[styles.menuIcon, item.tint && {backgroundColor: item.tint}]}>
              <Icon name={item.icon} size={20} color={item.iconColor || colors.primary} />
            </View>
            <View style={styles.menuText}>
              <Text style={styles.menuLabel}>{item.label}</Text>
              {!!item.note && <Text style={styles.menuNote}>{item.note}</Text>}
            </View>
            {item.badge != null && item.badge > 0 && (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{item.badge}</Text>
              </View>
            )}
            <Icon
              name={item.external ? 'open-in-new' : 'chevron-right'}
              size={item.external ? 16 : 22}
              color={colors.muted}
            />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function ProfileScreen({navigation}) {
  const {orders, wishlist, count} = useCart();
  const {user, signIn, signOut} = useAuth();

  const onChangePhoto = () => {
    if (!user) {
      Alert.alert('Log in', 'Please log in to set a profile photo.', [
        {text: 'Cancel', style: 'cancel'},
        {text: 'Log in', onPress: () => navigation.navigate('Login')},
      ]);
      return;
    }
    // TODO: upload the photo to the backend so it survives a reinstall / new device
    chooseProfilePhoto(!!user.photo, photo => signIn({...user, photo}));
  };

  const stats = [
    {icon: 'package-variant-closed', value: orders.length, label: 'Orders', onPress: () => navigation.navigate('Orders')},
    {icon: 'heart-outline', value: wishlist.length, label: 'Wishlist', onPress: () => navigation.navigate('Wishlist')},
    {icon: 'cart-outline', value: count, label: 'In cart', onPress: () => navigation.navigate('Cart')},
  ];

  const sections = [
    {
      title: 'MY ACCOUNT',
      items: [
        {
          icon: 'account-edit-outline',
          label: 'Edit Profile',
          note: 'Name, email, mobile',
          onPress: () => (user ? navigation.navigate('EditProfile') : navigation.navigate('Login')),
        },
        {icon: 'package-variant-closed', label: 'My Orders', note: 'Track, return or reorder', badge: orders.length, onPress: () => navigation.navigate('Orders')},
        {icon: 'heart-outline', label: 'My Wishlist', note: 'Products you saved', badge: wishlist.length, onPress: () => navigation.navigate('Wishlist')},
        {icon: 'cart-outline', label: 'My Cart', note: 'Ready to check out', badge: count, onPress: () => navigation.navigate('Cart')},
      ],
    },
    {
      title: 'HEALTH & CONSULTATION',
      items: [
        {icon: 'stethoscope', label: 'Expert Advice', note: 'Ask our Unani experts', onPress: () => openLink(PAGES.expertAdvice), external: true},
        {icon: 'map-marker-radius-outline', label: 'Clinic Locations', note: 'Delhi, Mumbai, Lucknow & more', onPress: () => openLink(PAGES.clinics), external: true},
        {icon: 'book-open-page-variant-outline', label: 'Sulemani Nuskhe', note: 'Traditional home remedies', onPress: () => openLink(PAGES.sulemaniNuskhe), external: true},
        {icon: 'account-voice', label: 'Patient Stories', note: 'Real experiences', onPress: () => openLink(PAGES.patientSpeaks), external: true},
      ],
    },
    {
      title: 'HELP & SUPPORT',
      items: [
        {icon: 'whatsapp', label: 'Chat on WhatsApp', note: CONTACT.whatsapp, tint: '#E8F8EE', iconColor: '#25D366', onPress: () => openLink(CONTACT.whatsappUrl)},
        {icon: 'phone-outline', label: 'Call Us', note: CONTACT.phone, onPress: () => openLink(CONTACT.phoneUrl)},
        {icon: 'email-outline', label: 'Email Us', note: CONTACT.email, onPress: () => openLink(CONTACT.emailUrl)},
      ],
    },
    {
      title: 'ABOUT & POLICIES',
      items: [
        {icon: 'leaf', label: 'About Atiya Herbs', onPress: () => openLink(PAGES.about), external: true},
        {icon: 'account-tie-outline', label: 'Hakeem Suleman Khan', onPress: () => openLink(PAGES.hakeem), external: true},
        {icon: 'storefront-outline', label: 'Franchise Enquiry', onPress: () => openLink(PAGES.franchise), external: true},
        {icon: 'shield-lock-outline', label: 'Privacy Policy', onPress: () => openLink(PAGES.privacy), external: true},
        {icon: 'cash-refund', label: 'Refund Policy', onPress: () => openLink(PAGES.refund), external: true},
        {icon: 'swap-horizontal', label: 'Return & Replacement', onPress: () => openLink(PAGES.returns), external: true},
        {icon: 'file-document-outline', label: 'Terms & Conditions', onPress: () => openLink(PAGES.terms), external: true},
      ],
    },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Greeting card */}
        <View style={styles.hero}>
          <Icon name="leaf" size={120} color="rgba(255,255,255,0.07)" style={styles.heroLeaf} />
          <View style={styles.heroRow}>
            <Pressable onPress={onChangePhoto} accessibilityLabel="Change profile photo">
              <View style={styles.avatar}>
                {user?.photo ? (
                  <Image source={{uri: user.photo}} style={styles.avatarPhoto} />
                ) : (
                  <Icon name="account" size={34} color={colors.primary} />
                )}
              </View>
              <View style={styles.cameraBadge}>
                <Icon name="camera" size={13} color="#fff" />
              </View>
            </Pressable>
            <View style={styles.heroText}>
              <Text style={styles.heading} numberOfLines={1}>
                Hello, {user ? user.name.split(' ')[0] : 'Guest'}
              </Text>
              <Text style={styles.sub} numberOfLines={2}>
                {user ? user.email : 'Log in for faster checkout and to track your orders'}
              </Text>
              {user?.provider === 'google' && (
                <View style={styles.providerTag}>
                  <Icon name="google" size={12} color="#fff" />
                  <Text style={styles.providerText}>Signed in with Google</Text>
                </View>
              )}
            </View>
          </View>
          {user ? (
            <View style={styles.authRow}>
              <Pressable
                style={[styles.authBtn, styles.signupBtn]}
                onPress={() =>
                  Alert.alert('Log out', 'Do you want to log out?', [
                    {text: 'Cancel', style: 'cancel'},
                    {text: 'Log out', style: 'destructive', onPress: signOut},
                  ])
                }>
                <Text style={styles.signupText}>Log out</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.authRow}>
              <Pressable style={[styles.authBtn, styles.loginBtn]} onPress={() => navigation.navigate('Login')}>
                <Text style={styles.loginText}>Login</Text>
              </Pressable>
              <Pressable style={[styles.authBtn, styles.signupBtn]} onPress={() => navigation.navigate('SignUp')}>
                <Text style={styles.signupText}>Sign Up</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Quick stats */}
        <View style={styles.stats}>
          {stats.map((s, i) => (
            <Pressable
              key={s.label}
              style={[styles.stat, i < stats.length - 1 && styles.statDivider]}
              onPress={s.onPress}>
              <Icon name={s.icon} size={22} color={s.color} />
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* App offer */}
        <Pressable
          style={styles.offer}
          onPress={() => navigation.navigate('ProductList', {title: 'All Products'})}>
          <View style={styles.offerIcon}>
            <Icon name="ticket-percent" size={24} color={colors.accent} />
          </View>
          <View style={styles.offerText}>
            <Text style={styles.offerTitle}>Extra 5% off on app orders</Text>
            <Text style={styles.offerNote}>
              Use code <Text style={styles.offerCode}>APP5</Text> at checkout
            </Text>
          </View>
          <Icon name="chevron-right" size={22} color={colors.accent} />
        </Pressable>

        {sections.map(section => (
          <MenuSection key={section.title} title={section.title} items={section.items} />
        ))}

        {/* Social */}
        <Text style={[styles.sectionTitle, styles.followTitle]}>FOLLOW US</Text>
        <View style={styles.socialRow}>
          {SOCIAL.map(s => (
            <Pressable
              key={s.id}
              style={styles.socialBtn}
              onPress={() => openLink(s.url)}
              accessibilityLabel={s.id}>
              {s.icon ? (
                <Icon name={s.icon} size={22} color={s.color} />
              ) : (
                <Text style={[styles.socialLetter, {color: s.color}]}>{s.label}</Text>
              )}
            </Pressable>
          ))}
        </View>

        <View style={styles.footer}>
          <View style={styles.trustRow}>
            {[
              ['shield-check-outline', '100% Genuine'],
              ['truck-fast-outline', 'Free Delivery'],
              ['leaf-circle-outline', 'Pure Herbal'],
            ].map(([icon, label]) => (
              <View key={label} style={styles.trustItem}>
                <Icon name={icon} size={18} color={colors.primary} />
                <Text style={styles.trustText}>{label}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.footerText}>Atiya Herbs · Unani & Ayurvedic remedies by Hakim Suleman Khan</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.primaryLight},
  content: {padding: spacing.md, paddingBottom: 40},
  hero: {
    backgroundColor: colors.primary,
    borderRadius: 18,
    padding: spacing.md,
    paddingBottom: 40,
    overflow: 'hidden',
  },
  heroLeaf: {position: 'absolute', right: -20, top: -20, transform: [{rotate: '-20deg'}]},
  heroRow: {flexDirection: 'row', alignItems: 'center'},
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  avatarPhoto: {width: '100%', height: '100%', borderRadius: 30},
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerTag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 6,
  },
  providerText: {color: '#fff', fontSize: 11, fontWeight: '600', marginLeft: 4},
  heroText: {flex: 1, marginLeft: spacing.md},
  heading: {fontSize: 21, fontWeight: '800', color: '#fff'},
  sub: {color: '#D7F0E0', marginTop: 4, fontSize: 13, lineHeight: 18},
  authRow: {flexDirection: 'row', marginTop: spacing.md},
  authBtn: {flex: 1, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center'},
  loginBtn: {backgroundColor: colors.accent, marginRight: 10},
  loginText: {color: '#fff', fontWeight: '800', fontSize: 15},
  signupBtn: {borderWidth: 1.5, borderColor: '#fff'},
  signupText: {color: '#fff', fontWeight: '800', fontSize: 15},
  stats: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    borderRadius: 14,
    marginTop: -26,
    marginHorizontal: spacing.sm,
    paddingVertical: 12,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: {width: 0, height: 2},
  },
  stat: {flex: 1, alignItems: 'center'},
  statDivider: {borderRightWidth: 1, borderRightColor: colors.border},
  statValue: {fontSize: 18, fontWeight: '800', color: colors.text, marginTop: 4},
  statLabel: {fontSize: 11, color: colors.muted, marginTop: 1},
  offer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cream,
    borderWidth: 1,
    borderColor: colors.creamBorder,
    borderStyle: 'dashed',
    borderRadius: 14,
    padding: 12,
    marginTop: spacing.md,
  },
  offerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offerText: {flex: 1, marginLeft: 12},
  offerTitle: {fontWeight: '800', color: colors.text, fontSize: 14},
  offerNote: {color: colors.muted, fontSize: 12, marginTop: 2},
  offerCode: {color: colors.accent, fontWeight: '800'},
  section: {marginTop: spacing.lg},
  sectionTitle: {fontSize: 12, fontWeight: '800', color: colors.muted, letterSpacing: 0.8, marginBottom: 8, marginLeft: 4},
  menu: {backgroundColor: colors.background, borderRadius: 14, overflow: 'hidden'},
  menuRow: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12},
  menuDivider: {borderBottomWidth: 1, borderBottomColor: colors.border},
  menuPressed: {backgroundColor: colors.card},
  menuIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuText: {flex: 1, marginLeft: 12},
  menuLabel: {fontWeight: '700', color: colors.text, fontSize: 15},
  menuNote: {color: colors.muted, fontSize: 12, marginTop: 2},
  countBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    marginRight: 6,
  },
  countBadgeText: {color: '#fff', fontSize: 11, fontWeight: '800'},
  followTitle: {marginTop: spacing.lg},
  socialRow: {flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.sm},
  socialBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialLetter: {fontSize: 20, fontWeight: '900', color: colors.primary},
  footer: {alignItems: 'center', marginTop: spacing.lg},
  trustRow: {flexDirection: 'row', justifyContent: 'center'},
  trustItem: {flexDirection: 'row', alignItems: 'center', marginHorizontal: 8},
  trustText: {fontSize: 11, color: colors.text, fontWeight: '600', marginLeft: 4},
  footerText: {fontSize: 11, color: colors.muted, marginTop: 10, textAlign: 'center'},
});
