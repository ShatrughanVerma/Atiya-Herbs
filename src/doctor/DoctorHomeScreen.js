import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, Alert, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import EmptyState from '../components/shop/EmptyState';
import AppointmentPickerSheet from './AppointmentPickerSheet';
import VideoUploadSheet from './VideoUploadSheet';
import {pickVideoFromGallery} from './pickVideo';
import {fetchDoctorAppointments, fetchDoctorDashboard, fetchDoctorMe} from '../services/doctorApi';
import {typeLabel, formatTime, todayYmd} from '../utils/consult';
import {doctorSubtitle, greetingFor} from '../utils/doctor';
import {colors, spacing} from '../theme';

// The shortcuts. The ones without a screen yet say so instead of doing nothing.
const TILES = [
  {id: 'rx', label: 'Rx templates', icon: 'file-document-outline', soon: true},
  {id: 'bookings', label: 'Clinic bookings', icon: 'calendar-month-outline', tab: 'Appointment'},
  {id: 'records', label: 'Visit records', icon: 'heart-outline', soon: true},
  {id: 'stock', label: 'Clinic stock', icon: 'cube-outline', soon: true},
  {id: 'bills', label: 'Bills', icon: 'wallet-outline', soon: true},
  {id: 'coupons', label: 'Coupons', icon: 'tag-outline', soon: true},
  {id: 'meetings', label: 'Meetings', icon: 'video-outline', screen: 'Meetings'},
  {id: 'times', label: 'Days & times', icon: 'clock-outline', screen: 'DaysTimes'},
];

export default function DoctorHomeScreen({navigation}) {
  const [me, setMe] = useState(null);
  const [numbers, setNumbers] = useState(null);
  const [today, setToday] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [refreshing, setRefreshing] = useState(false);
  const [chosenVideo, setChosenVideo] = useState(null); // the video picked from the gallery
  const [videoFor, setVideoFor] = useState(null); // the appointment it belongs to

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

  // The button opens the phone's gallery at once; then the doctor says which visit the video is of
  const startVideo = async () => {
    const video = await pickVideoFromGallery();
    if (video) {
      setChosenVideo(video);
    }
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
    {key: 'today', label: 'Today', value: numbers.todayAppointments, icon: 'calendar-month-outline', tint: '#F4F8F4'},
    {key: 'requests', label: 'New requests', value: numbers.requestedAppointments, icon: 'bell-outline', tint: '#FFF7D6', go: () => navigation.navigate('Appointment', {status: 'requested'})},
    {key: 'upcoming', label: 'Upcoming', value: numbers.upcomingAppointments, icon: 'clock-outline', tint: '#F4F8F4', go: () => navigation.navigate('Appointment', {status: 'booked'})},
    {key: 'patients', label: 'Patients', value: numbers.patients, icon: 'account-multiple-outline', tint: '#E3F1E6', go: () => navigation.navigate('Patients')},
  ];

  return (
    <View style={styles.container}>
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />} contentContainerStyle={styles.scroll}>
        <SafeAreaView edges={['top']} style={styles.header}>
          <View style={styles.headerRow}>
            {me.photoUrl ? (
              <Image source={{uri: me.photoUrl}} style={styles.avatar} />
            ) : (
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{me.name.replace(/^Dr\.?\s+/i, '').charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <View style={styles.headerText}>
              <Text style={styles.greeting}>{greetingFor()}</Text>
              <Text style={styles.name} numberOfLines={1}>
                {me.name}
              </Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {doctorSubtitle(me)}
              </Text>
            </View>
            <Pressable style={styles.bell} onPress={() => navigation.navigate('Appointment', {status: 'requested'})} accessibilityRole="button" accessibilityLabel="New requests">
              <Icon name="bell-outline" size={28} color={colors.primaryDark} />
              {numbers.requestedAppointments > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{numbers.requestedAppointments > 9 ? '9+' : numbers.requestedAppointments}</Text>
                </View>
              )}
            </Pressable>
          </View>
        </SafeAreaView>

        <View style={styles.cards}>
          {cards.map(card => (
            <Pressable key={card.key} style={[styles.card, {backgroundColor: card.tint}]} onPress={card.go} disabled={!card.go} accessibilityRole={card.go ? 'button' : undefined}>
              <View style={styles.cardIcon}>
                <Icon name={card.icon} size={26} color={colors.primaryDark} />
              </View>
              <Text style={styles.cardValue}>{card.value}</Text>
              <Text style={styles.cardLabel}>{card.label}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable style={styles.uploadBtn} onPress={startVideo} accessibilityRole="button" accessibilityLabel="Upload visit video">
          <Icon name="video-plus-outline" size={24} color="#fff" />
          <Text style={styles.uploadText}>Upload visit video</Text>
        </Pressable>

        <View style={styles.tiles}>
          {TILES.map(tile => (
            <Pressable key={tile.id} style={styles.tile} onPress={() => openTile(tile)} accessibilityRole="button" accessibilityLabel={tile.soon ? `${tile.label}, coming soon` : tile.label}>
              <View style={[styles.tileIcon, tile.soon && styles.tileSoon]}>
                <Icon name={tile.icon} size={26} color={colors.primaryDark} />
              </View>
              <Text style={[styles.tileLabel, tile.soon && styles.tileLabelSoon]}>{tile.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Today&apos;s schedule</Text>
          <Pressable onPress={() => navigation.navigate('Appointment', {status: 'booked'})} hitSlop={8}>
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        </View>
        {today.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Icon name="calendar-month-outline" size={44} color={colors.primaryDark} />
            </View>
            <Text style={styles.emptyTitle}>No appointments today</Text>
            <Text style={styles.emptyNote}>Confirmed bookings for today show up here.</Text>
          </View>
        ) : (
          today.map(a => (
            <View key={a.id} style={styles.slot}>
              <Text style={styles.slotTime}>{formatTime(a.startsAt)}</Text>
              <View style={styles.slotBody}>
                <Text style={styles.slotName}>{a.patientName}</Text>
                <Text style={styles.slotMeta} numberOfLines={1}>
                  {typeLabel(a.type)}
                  {a.concern ? ` · ${a.concern}` : ''}
                </Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
      {!!chosenVideo && !videoFor && (
        <AppointmentPickerSheet
          onClose={() => setChosenVideo(null)}
          onPick={a => setVideoFor(a)}
        />
      )}
      {!!chosenVideo && !!videoFor && (
        <VideoUploadSheet
          appointment={videoFor}
          video={chosenVideo}
          onClose={() => {
            setVideoFor(null);
            setChosenVideo(null);
          }}
        />
      )}
    </View>
  );
}

const SHADOW = {shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: {width: 0, height: 2}, elevation: 3};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  scroll: {paddingBottom: spacing.lg},
  header: {backgroundColor: colors.primaryDark, borderBottomLeftRadius: 36, borderBottomRightRadius: 36, paddingHorizontal: spacing.md, paddingBottom: 80},
  headerRow: {flexDirection: 'row', alignItems: 'center', paddingTop: 12},
  avatar: {width: 64, height: 64, borderRadius: 32, backgroundColor: '#E7F8EE', alignItems: 'center', justifyContent: 'center'},
  avatarText: {fontSize: 26, fontWeight: '800', color: colors.primaryDark},
  headerText: {flex: 1, marginHorizontal: 14},
  greeting: {color: '#fff', fontSize: 15},
  name: {color: '#fff', fontSize: 24, fontWeight: '800'},
  subtitle: {color: '#DCEFE2', fontSize: 13, marginTop: 2},
  bell: {width: 52, height: 52, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center'},
  badge: {position: 'absolute', top: 6, right: 6, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4},
  badgeText: {color: '#fff', fontSize: 10, fontWeight: '800'},
  cards: {flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.md, marginTop: -56, justifyContent: 'space-between'},
  card: {width: '48%', borderRadius: 22, padding: 16, marginBottom: 12, ...SHADOW},
  cardIcon: {width: 46, height: 46, borderRadius: 23, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center'},
  cardValue: {fontSize: 34, fontWeight: '800', color: colors.primaryDark, marginTop: 14},
  cardLabel: {color: colors.muted, fontSize: 16, marginTop: 2},
  uploadBtn: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryDark, borderRadius: 28, height: 56, marginHorizontal: spacing.md, marginTop: 4, marginBottom: 14},
  uploadText: {color: '#fff', fontWeight: '800', fontSize: 17, marginLeft: 10},
  tiles: {flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#fff', borderRadius: 22, marginHorizontal: spacing.md, marginTop: 0, paddingVertical: 12, ...SHADOW},
  tile: {width: '25%', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4},
  tileIcon: {width: 58, height: 58, borderRadius: 29, backgroundColor: '#E7F5EA', alignItems: 'center', justifyContent: 'center'},
  tileSoon: {opacity: 0.45},
  tileLabel: {textAlign: 'center', marginTop: 8, color: colors.text, fontSize: 13},
  tileLabelSoon: {color: colors.muted},
  sectionHead: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.md, marginTop: 24, marginBottom: 8},
  sectionTitle: {fontSize: 22, fontWeight: '800', color: colors.text},
  seeAll: {color: colors.primary, fontWeight: '700', fontSize: 16},
  empty: {alignItems: 'center', paddingVertical: 24, paddingHorizontal: spacing.lg},
  emptyIcon: {width: 100, height: 100, borderRadius: 50, backgroundColor: '#E7F5EA', alignItems: 'center', justifyContent: 'center'},
  emptyTitle: {fontSize: 20, fontWeight: '800', color: colors.text, marginTop: 14},
  emptyNote: {color: colors.muted, marginTop: 4, textAlign: 'center'},
  slot: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, marginHorizontal: spacing.md, marginBottom: 10, padding: 14, borderWidth: 1, borderColor: colors.border},
  slotTime: {width: 84, fontWeight: '800', color: colors.primaryDark},
  slotBody: {flex: 1},
  slotName: {fontWeight: '700', fontSize: 16, color: colors.text},
  slotMeta: {color: colors.muted, marginTop: 2},
});
