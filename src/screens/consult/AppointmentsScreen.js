import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DoctorAvatar from '../../components/consult/DoctorAvatar';
import EmptyState from '../../components/shop/EmptyState';
import ScreenHeader from '../../components/shop/ScreenHeader';
import {useAuth} from '../../context/AuthContext';
import {cancelAppointment, listAppointments} from '../../services/consultApi';
import {CONSULT_TYPES, formatDay, formatTime, formatYmd, typeLabel} from '../../utils/consult';
import {colors, formatPrice, spacing} from '../../theme';

// What the person reads. The doctor confirms or declines every request.
const STATUS_TEXT = {requested: 'Pending', booked: 'Confirmed', cancelled: 'Cancelled', completed: 'Completed'};
const CANCEL_BEFORE_MS = 60 * 60_000; // the server refuses later than this, so the button is hidden then

export default function AppointmentsScreen({navigation}) {
  const {user} = useAuth();
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setItems((await listAppointments()).items);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (user) {
      load();
    }
  }, [user, load]);

  // coming back to this screen shows the doctor's latest answer
  useEffect(() => navigation.addListener('focus', () => user && load()), [navigation, user, load]);

  const onCancel = appointment =>
    Alert.alert('Cancel appointment', `Cancel your appointment with ${appointment.doctor?.name ?? 'the doctor'}?`, [
      {text: 'Keep it', style: 'cancel'},
      {
        text: 'Cancel appointment',
        style: 'destructive',
        onPress: async () => {
          try {
            await cancelAppointment(appointment.id);
          } catch (error) {
            Alert.alert('Appointment', error.message);
          }
          load();
        },
      },
    ]);

  if (!user) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <ScreenHeader title="My Appointments" navigation={navigation} />
        <EmptyState icon="account-lock-outline" title="Log in to see your appointments" note="Your appointments are saved with your account." actionLabel="Log in" onAction={() => navigation.navigate('Login')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader title="My Appointments" navigation={navigation} />
      {status === 'loading' && items.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : status === 'error' && items.length === 0 ? (
        <EmptyState icon="cloud-off-outline" title="Could not load your appointments" note="Please check your internet and try again." actionLabel="Retry" onAction={load} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={a => a.id}
          contentContainerStyle={styles.list}
          refreshing={status === 'loading'}
          onRefresh={load}
          ListEmptyComponent={
            <EmptyState icon="calendar-blank-outline" title="No appointments yet" note="Book a consultation with one of our doctors." actionLabel="Find a doctor" onAction={() => navigation.navigate('Main', {screen: 'Clinic'})} />
          }
          renderItem={({item: a}) => {
            const canCancel =
              a.status === 'requested' || (a.status === 'booked' && new Date(a.startsAt).getTime() - Date.now() >= CANCEL_BEFORE_MS);
            return (
              <View style={styles.card}>
                <View style={styles.head}>
                  {!!a.doctor && <DoctorAvatar doctor={a.doctor} size={44} />}
                  <View style={styles.headText}>
                    <Text style={styles.doctor} numberOfLines={1}>
                      {a.doctor?.name ?? 'Doctor'}
                    </Text>
                    <Text style={styles.muted} numberOfLines={1}>
                      {a.doctor?.specialization}
                    </Text>
                  </View>
                  <View style={[styles.badge, a.status === 'cancelled' && styles.badgeOff]}>
                    <Text style={[styles.badgeText, a.status === 'cancelled' && styles.badgeOffText]}>{STATUS_TEXT[a.status]}</Text>
                  </View>
                </View>
                <View style={styles.line}>
                  <Icon name="calendar-clock-outline" size={16} color={colors.primary} />
                  <Text style={styles.lineText}>
                    {a.startsAt
                      ? `${a.status === 'requested' ? 'Requested: ' : ''}${formatDay(a.startsAt)}, ${formatTime(a.startsAt)}`
                      : a.preferredDate
                      ? `Preferred: ${formatYmd(a.preferredDate)} - the doctor will suggest a time`
                      : 'The doctor will suggest a day and time'}
                  </Text>
                </View>
                <View style={styles.line}>
                  <Icon name={CONSULT_TYPES.find(t => t.id === a.type)?.icon ?? 'stethoscope'} size={16} color={colors.primary} />
                  <Text style={styles.lineText}>
                    {typeLabel(a.type)}
                    {a.clinic ? ` · ${a.clinic.name}` : ''}
                  </Text>
                </View>
                {!!a.concern && (
                  <View style={styles.line}>
                    <Icon name="heart-pulse" size={16} color={colors.primary} />
                    <Text style={styles.lineText}>
                      {a.concern}
                      {a.duration ? ` · ${a.duration}` : ''}
                    </Text>
                  </View>
                )}
                {!a.forSelf && (
                  <View style={styles.line}>
                    <Icon name="account-multiple-outline" size={16} color={colors.primary} />
                    <Text style={styles.lineText}>For {a.patientName}</Text>
                  </View>
                )}
                {a.status === 'requested' && <Text style={styles.waiting}>Waiting for the doctor to confirm.</Text>}
                {a.status === 'cancelled' && !!a.cancelReason && <Text style={styles.reason}>Reason: {a.cancelReason}</Text>}
                <View style={styles.foot}>
                  <Text style={styles.muted}>#{a.number}</Text>
                  <Text style={styles.fee}>
                    {formatPrice(a.toPay)} · pay at consultation{a.creditsUsed > 0 ? ` (${a.creditsUsed} credits used)` : ''}
                  </Text>
                </View>
                {canCancel && (
                  <Pressable style={styles.cancelBtn} onPress={() => onCancel(a)} accessibilityRole="button" accessibilityLabel={`Cancel appointment ${a.number}`}>
                    <Text style={styles.cancelText}>Cancel appointment</Text>
                  </Pressable>
                )}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.card},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  list: {padding: spacing.md, flexGrow: 1},
  card: {backgroundColor: colors.background, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.border},
  head: {flexDirection: 'row', alignItems: 'center', marginBottom: 10},
  headText: {flex: 1, marginHorizontal: 10},
  doctor: {fontWeight: '800', color: colors.text, fontSize: 15},
  muted: {color: colors.muted, fontSize: 12},
  badge: {backgroundColor: colors.primaryLight, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4},
  badgeText: {color: colors.primary, fontWeight: '700', fontSize: 12},
  badgeOff: {backgroundColor: '#FDECEC'},
  waiting: {color: colors.accent, fontWeight: '600', marginTop: 8, fontSize: 13},
  reason: {color: colors.danger, marginTop: 8, fontSize: 13},
  badgeOffText: {color: colors.danger},
  line: {flexDirection: 'row', alignItems: 'center', marginTop: 4},
  lineText: {marginLeft: 8, color: colors.text},
  foot: {flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, marginTop: 10},
  fee: {fontWeight: '700', color: colors.text, fontSize: 12},
  cancelBtn: {alignSelf: 'flex-end', marginTop: 10, paddingVertical: 6, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.danger},
  cancelText: {color: colors.danger, fontWeight: '700', fontSize: 13},
});
