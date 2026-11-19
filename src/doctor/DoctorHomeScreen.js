import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, Alert, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import EmptyState from '../components/shop/EmptyState';
import VideoUploadForm from './VideoUploadForm';
import {fetchDoctorAppointments, fetchDoctorDashboard, fetchDoctorMe} from '../services/doctorApi';
import {typeLabel, formatTime, todayYmd} from '../utils/consult';
import {doctorSubtitle, greetingFor} from '../utils/doctor';
import {colors, spacing} from '../theme';

// The shortcuts. The ones without a screen yet say so instead of doing nothing.
const TILES = [
  {id: 'rx', label: 'Rx Templates', icon: 'file-document-outline', soon: true},
  {id: 'bookings', label: 'Clinic Bookings', icon: 'calendar-plus', tab: 'Appointment'},
  {id: 'videos', label: 'Consult Videos', icon: 'play-box-multiple-outline', screen: 'MyVideos'},
  {id: 'stock', label: 'Clinic Stock', icon: 'cube-outline', tab: 'Stock'},
  {id: 'bills', label: 'Bills', icon: 'wallet-outline', soon: true},
  {id: 'coupons', label: 'Coupons', icon: 'tag-outline', soon: true},
  {id: 'meetings', label: 'Meetings', icon: 'video-outline', screen: 'Meetings'},
  {id: 'times', label: 'Days & Times', icon: 'clock-outline', screen: 'DaysTimes'},
];

export default function DoctorHomeScreen({navigation}) {
  const [me, setMe] = useState(null);
  const [numbers, setNumbers] = useState(null);
  const [today, setToday] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [refreshing, setRefreshing] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false); // the upload form

  const load = useCallback(async () => {
    try {
      const [profile, stats, schedule] = await Promise.all([
        fetchDoctorMe(),
        fetchDoctorDashboard(),
        fetchDoctorAppointments({status: 'booked', date: todayYmd(), pageSize: 10}),
      ]);
      setMe(profile);
      setNumbers(stats);
      setToday(schedule.items.filter(a => a.startsAt).sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
      setStatus('ready');
    } catch (error) {
      setStatus(prev => (prev === 'ready' ? prev : error.kind === 'forbidden' ? 'forbidden' : 'error'));
    }
  }, []);

  useEffect(() => {
    load();
    // coming back to Home shows the newest numbers
    return navigation.addListener('focus', load);
  }, [load, navigation]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const openTile = tile => {
    if (tile.soon) {
      Alert.alert(tile.label, 'This is coming soon.');
    } else if (tile.tab) {
      navigation.navigate(tile.tab);
    } else {
      navigation.navigate(tile.screen);
    }
  };

  if (status === 'loading') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </SafeAreaView>
    );
  }
  if (status !== 'ready') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <EmptyState
          icon={status === 'forbidden' ? 'account-lock-outline' : 'cloud-off-outline'}
          title={status === 'forbidden' ? 'No doctor profile is linked to this login' : 'Could not load your dashboard'}
          note={status === 'forbidden' ? 'Please ask the Atiya Herbs office to link your login to your doctor profile.' : 'Please check your internet and try again.'}
          actionLabel="Retry"
          onAction={() => {
            setStatus('loading');
            load();
          }}
        />
      </SafeAreaView>
    );
  }

  const cards = [
    {
      key: 'today',
      label: 'Today',
      value: numbers.todayAppointments,
      icon: 'calendar-month-outline',
      tint: '#E4F5E8',
      accent: colors.primary,
      action: numbers.todayAppointments === 0 ? 'No appointments yet' : 'View today',
      go: () => navigation.navigate('Appointment', {status: 'booked'}),
    },
    {
      key: 'requests',
      label: 'New requests',
      value: numbers.requestedAppointments,
      icon: 'bell',
      tint: '#FFF3D0',
      accent: '#F59E0B',
      action: 'View details',
      go: () => navigation.navigate('Appointment', {status: 'requested'}),
    },
    {
      key: 'upcoming',
      label: 'Upcoming',
      value: numbers.upcomingAppointments,
      icon: 'clock-outline',
      tint: '#E6EBFF',
      accent: '#1D4ED8',
      action: 'View schedule',
      go: () => navigation.navigate('Appointment', {status: 'booked'}),
    },
    {
      key: 'patients',
      label: 'Patients',
      value: numbers.patients,
      icon: 'account-multiple',
      tint: '#E1F3E6',
      accent: colors.primary,
      action: 'View all patients',
      go: () => navigation.navigate('Patients'),
    },
  ];

  return (
    <View style={styles.container}>
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />} contentContainerStyle={styles.scroll}>
        <SafeAreaView edges={['top']} style={styles.header}>
          {/* soft shapes behind the greeting */}
          <View style={styles.blobOne} pointerEvents="none" />
          <View style={styles.blobTwo} pointerEvents="none" />
          <Icon name="leaf" size={90} color="rgba(255,255,255,0.12)" style={styles.headerLeaf} />
          <View style={styles.headerRow}>
            <View>
              {me.photoUrl ? (
                <Image source={{uri: me.photoUrl}} style={styles.avatar} />
              ) : (
                <View style={styles.avatar}>
                  <Text maxFontSizeMultiplier={1.1} style={styles.avatarText}>{me.name.replace(/^Dr\.?\s+/i, '').charAt(0).toUpperCase()}</Text>
                </View>
              )}
              <View style={styles.verified}>
                <Icon name="check" size={13} color="#fff" />
              </View>
            </View>
            <View style={styles.headerText}>
              <Text maxFontSizeMultiplier={1.1} style={styles.greeting}>{greetingFor()}</Text>
              <Text maxFontSizeMultiplier={1.1} style={styles.name} numberOfLines={1}>
                {me.name}
              </Text>
              <Text maxFontSizeMultiplier={1.1} style={styles.subtitle} numberOfLines={1}>
                {doctorSubtitle(me)}
              </Text>
            </View>
            <Pressable style={styles.bell} onPress={() => navigation.navigate('Appointment', {status: 'requested'})} accessibilityRole="button" accessibilityLabel="New requests">
              <Icon name="bell-outline" size={28} color={colors.primaryDark} />
              {numbers.requestedAppointments > 0 && <View style={styles.badge} />}
            </Pressable>
          </View>
        </SafeAreaView>

        <View style={styles.cards}>
          {cards.map(card => (
            <Pressable key={card.key} style={[styles.card, {backgroundColor: card.tint}]} onPress={card.go} accessibilityRole="button" accessibilityLabel={`${card.label}, ${card.value}`}>
              <Icon name={card.icon} size={64} color={card.accent} style={styles.cardWatermark} />
              <View style={[styles.cardIcon, {backgroundColor: card.accent + '22'}]}>
                <Icon name={card.icon} size={22} color={card.accent} />
              </View>
              <Text maxFontSizeMultiplier={1.1} style={styles.cardLabel}>{card.label}</Text>
              <Text maxFontSizeMultiplier={1.1} style={styles.cardValue}>{card.value}</Text>
              <View style={[styles.cardPill, {backgroundColor: card.accent + '1F'}]}>
                <Text maxFontSizeMultiplier={1.1} style={[styles.cardPillText, {color: card.accent}]} numberOfLines={1}>
                  {card.action}
                </Text>
                <View style={[styles.cardArrow, {backgroundColor: card.accent}]}>
                  <Icon name="arrow-right" size={14} color="#fff" />
                </View>
              </View>
            </Pressable>
          ))}
        </View>

        <View style={styles.tiles}>
          {TILES.map(tile => (
            <Pressable key={tile.id} style={styles.tile} onPress={() => openTile(tile)} accessibilityRole="button" accessibilityLabel={tile.soon ? `${tile.label}, coming soon` : tile.label}>
              <View style={styles.tileIcon}>
                <Icon name={tile.icon} size={28} color={colors.primaryDark} />
              </View>
              <Text maxFontSizeMultiplier={1.1} style={styles.tileLabel}>{tile.label}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable style={styles.uploadBtn} onPress={() => setUploadOpen(true)} accessibilityRole="button" accessibilityLabel="Upload Consultation Video">
          <Icon name="video-plus-outline" size={22} color="#fff" />
          <Text maxFontSizeMultiplier={1.1} style={styles.uploadText}>Upload Consultation Video</Text>
        </Pressable>

        <View style={styles.promo}>
          <View style={styles.promoText}>
            <View style={styles.promoTag}>
              <Text maxFontSizeMultiplier={1.1} style={styles.promoTagText}>Atiya Herbs</Text>
            </View>
            <Text maxFontSizeMultiplier={1.1} style={styles.promoTitle}>Better Health,{'\n'}Naturally</Text>
            <Text maxFontSizeMultiplier={1.1} style={styles.promoNote}>Unani Wisdom for a Healthier Tomorrow</Text>
            <Pressable style={styles.promoBtn} onPress={() => Alert.alert('Atiya Herbs', 'This is coming soon.')} accessibilityRole="button">
              <Text maxFontSizeMultiplier={1.1} style={styles.promoBtnText}>Learn More</Text>
              <Icon name="arrow-right" size={16} color="#fff" />
            </Pressable>
          </View>
          <Icon name="leaf" size={70} color="#7BB661" style={styles.promoLeaf} />
          <Icon name="mortar-pestle" size={96} color="#8A5A2B" style={styles.promoMortar} />
        </View>

        <View style={styles.sectionHead}>
          <View style={styles.sectionLeft}>
            <Icon name="calendar-month-outline" size={26} color={colors.primaryDark} />
            <Text maxFontSizeMultiplier={1.1} style={styles.sectionTitle}>Today&apos;s Schedule</Text>
          </View>
          <Pressable onPress={() => navigation.navigate('Appointment', {status: 'booked'})} hitSlop={8} style={styles.seeAllRow}>
            <Text maxFontSizeMultiplier={1.1} style={styles.seeAll}>See all</Text>
            <Icon name="arrow-right" size={18} color={colors.primary} />
          </Pressable>
        </View>
        {today.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="calendar-plus" size={34} color={colors.primary} />
            <Text maxFontSizeMultiplier={1.1} style={styles.emptyTitle}>No appointments for today</Text>
            <Text maxFontSizeMultiplier={1.1} style={styles.emptyNote}>Enjoy your day!</Text>
          </View>
        ) : (
          today.map(a => (
            <View key={a.id} style={styles.slot}>
              <Text maxFontSizeMultiplier={1.1} style={styles.slotTime}>{formatTime(a.startsAt)}</Text>
              <View style={styles.slotBody}>
                <Text maxFontSizeMultiplier={1.1} style={styles.slotName}>{a.patientName}</Text>
                <Text maxFontSizeMultiplier={1.1} style={styles.slotMeta} numberOfLines={1}>
                  {typeLabel(a.type)}
                  {a.concern ? ` · ${a.concern}` : ''}
                </Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
      {uploadOpen && <VideoUploadForm doctorId={me.id} onClose={() => setUploadOpen(false)} />}
    </View>
  );
}

const SHADOW = {shadowColor: '#0B3D1E', shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: {width: 0, height: 3}, elevation: 3};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  scroll: {paddingBottom: spacing.lg},
  header: {backgroundColor: '#0E7A36', borderBottomLeftRadius: 40, borderBottomRightRadius: 40, paddingHorizontal: spacing.md, paddingBottom: 92, overflow: 'hidden'},
  blobOne: {position: 'absolute', width: 320, height: 320, borderRadius: 160, backgroundColor: 'rgba(255,255,255,0.07)', top: -150, right: -90},
  blobTwo: {position: 'absolute', width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(0,0,0,0.06)', bottom: -120, left: -60},
  headerLeaf: {position: 'absolute', right: 70, bottom: 50, transform: [{rotate: '25deg'}]},
  headerRow: {flexDirection: 'row', alignItems: 'center', paddingTop: 14},
  avatar: {width: 66, height: 66, borderRadius: 33, backgroundColor: '#E4F5E8', alignItems: 'center', justifyContent: 'center'},
  avatarText: {fontSize: 32, fontWeight: '800', color: colors.primaryDark},
  verified: {position: 'absolute', right: -2, bottom: 0, width: 24, height: 24, borderRadius: 12, backgroundColor: '#22A653', borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center'},
  headerText: {flex: 1, marginHorizontal: 12},
  greeting: {color: '#fff', fontSize: 14},
  name: {color: '#fff', fontSize: 21, fontWeight: '800'},
  subtitle: {color: '#E0F2E5', fontSize: 12, marginTop: 2},
  bell: {width: 48, height: 48, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center'},
  badge: {position: 'absolute', top: 10, right: 12, width: 12, height: 12, borderRadius: 6, backgroundColor: '#EF4444', borderWidth: 2, borderColor: '#fff'},
  cards: {flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.md, marginTop: -64, justifyContent: 'space-between'},
  card: {width: '48.5%', borderRadius: 20, padding: 12, marginBottom: 10, overflow: 'hidden', ...SHADOW},
  cardWatermark: {position: 'absolute', right: -6, top: 2, opacity: 0.13},
  cardIcon: {width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center'},
  cardLabel: {color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 6},
  cardValue: {fontSize: 28, fontWeight: '800', color: colors.primaryDark, marginTop: 0},
  cardPill: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 20, paddingLeft: 12, paddingRight: 4, height: 30, marginTop: 6},
  cardPillText: {flex: 1, fontSize: 12, fontWeight: '700'},
  cardArrow: {width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center'},
  tiles: {flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#fff', borderRadius: 24, marginHorizontal: spacing.md, marginTop: 4, paddingVertical: 12, ...SHADOW},
  tile: {width: '25%', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 2},
  tileIcon: {width: 56, height: 56, borderRadius: 28, backgroundColor: '#E8F6EC', alignItems: 'center', justifyContent: 'center'},
  tileLabel: {textAlign: 'center', marginTop: 8, color: colors.text, fontSize: 12, fontWeight: '500'},
  uploadBtn: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryDark, borderRadius: 28, height: 52, marginHorizontal: spacing.md, marginTop: 14},
  uploadText: {color: '#fff', fontWeight: '800', fontSize: 16, marginLeft: 10},
  promo: {flexDirection: 'row', backgroundColor: '#E9F6DA', borderRadius: 24, marginHorizontal: spacing.md, marginTop: 14, padding: 18, overflow: 'hidden', minHeight: 170},
  promoText: {flex: 1, zIndex: 1},
  promoTag: {alignSelf: 'flex-start', backgroundColor: '#D3EDC1', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 5, borderWidth: 1, borderColor: '#BFE3A9'},
  promoTagText: {color: colors.primaryDark, fontWeight: '700', fontSize: 14},
  promoTitle: {fontSize: 23, fontWeight: '800', color: colors.primaryDark, marginTop: 8, lineHeight: 28},
  promoNote: {color: colors.text, fontSize: 13, marginTop: 4, maxWidth: '70%'},
  promoBtn: {flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: colors.primaryDark, borderRadius: 22, paddingHorizontal: 18, height: 42, marginTop: 12},
  promoBtnText: {color: '#fff', fontWeight: '700', fontSize: 15, marginRight: 8},
  promoLeaf: {position: 'absolute', right: 16, top: 6, transform: [{rotate: '-20deg'}]},
  promoMortar: {position: 'absolute', right: 14, bottom: 8},
  sectionHead: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.md, marginTop: 22, marginBottom: 10},
  sectionLeft: {flexDirection: 'row', alignItems: 'center'},
  sectionTitle: {fontSize: 18, fontWeight: '800', color: colors.text, marginLeft: 10},
  seeAllRow: {flexDirection: 'row', alignItems: 'center'},
  seeAll: {color: colors.primary, fontWeight: '700', fontSize: 16, marginRight: 4},
  empty: {alignItems: 'center', backgroundColor: '#EDF8EF', borderRadius: 22, marginHorizontal: spacing.md, paddingVertical: 22, paddingHorizontal: spacing.lg},
  emptyTitle: {fontSize: 17, fontWeight: '600', color: colors.muted, marginTop: 8},
  emptyNote: {color: colors.primary, fontWeight: '600', marginTop: 4, textAlign: 'center'},
  slot: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, marginHorizontal: spacing.md, marginBottom: 10, padding: 14, borderWidth: 1, borderColor: colors.border},
  slotTime: {width: 84, fontWeight: '800', color: colors.primaryDark},
  slotBody: {flex: 1},
  slotName: {fontWeight: '700', fontSize: 16, color: colors.text},
  slotMeta: {color: colors.muted, marginTop: 2},
});
