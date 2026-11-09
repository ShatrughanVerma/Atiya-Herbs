import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, Alert, FlatList, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import EmptyState from '../components/shop/EmptyState';
import VideoUploadSheet from './VideoUploadSheet';
import {pickVideoFromGallery} from './pickVideo';
import {
  completeAppointmentAsDoctor,
  confirmAppointmentAsDoctor,
  declineAppointment,
  fetchDoctorAppointments,
} from '../services/doctorApi';
import {fetchSlots} from '../services/consultApi';
import {CONSULT_TYPES, formatDay, formatTime, formatYmd, typeLabel, upcomingDays} from '../utils/consult';
import {colors, formatPrice, spacing} from '../theme';

const FILTERS = [
  {id: 'requested', label: 'Pending'},
  {id: 'booked', label: 'Confirmed'},
  {id: 'completed', label: 'Completed'},
  {id: 'cancelled', label: 'Cancelled'},
  {id: null, label: 'All'},
];
const STATUS_TEXT = {requested: 'Pending', booked: 'Confirmed', cancelled: 'Cancelled', completed: 'Completed'};

// The doctor picks a time for a request that came without one
function ConfirmTimeSheet({appointment, onClose, onChosen}) {
  const days = useMemo(() => upcomingDays(14), []);
  const first = appointment.preferredDate && days.some(d => d.ymd === appointment.preferredDate) ? appointment.preferredDate : days[0].ymd;
  const [day, setDay] = useState(first);
  const [slots, setSlots] = useState([]);
  const [state, setState] = useState('loading');
  const [chosen, setChosen] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setChosen(null);
    fetchSlots(appointment.doctor.id, day)
      .then(res => {
        if (!cancelled) {
          setSlots(res.slots);
          setState('ready');
        }
      })
      .catch(() => !cancelled && setState('error'));
    return () => {
      cancelled = true;
    };
  }, [appointment.doctor.id, day]);

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Choose a time</Text>
          <Text style={styles.muted}>
            {appointment.patientName}
            {appointment.preferredDate ? ` asked for ${formatYmd(appointment.preferredDate)}` : ' has no day in mind'}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.days}>
            {days.map(d => (
              <Pressable key={d.ymd} style={[styles.dayBtn, day === d.ymd && styles.on]} onPress={() => setDay(d.ymd)} accessibilityRole="button">
                <Text style={[styles.dayName, day === d.ymd && styles.onText]}>{d.day}</Text>
                <Text style={[styles.dayNum, day === d.ymd && styles.onText]}>{d.date}</Text>
                <Text style={[styles.dayName, day === d.ymd && styles.onText]}>{d.month}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {state === 'loading' ? (
            <ActivityIndicator color={colors.primary} style={styles.loading} />
          ) : state === 'error' ? (
            <Text style={styles.error}>Could not load the times. Please try again.</Text>
          ) : slots.length === 0 ? (
            <Text style={styles.muted}>No free times on this day.</Text>
          ) : (
            <ScrollView style={styles.slotsBox}>
              <View style={styles.wrap}>
                {slots.map(s => (
                  <Pressable key={s.startsAt} style={[styles.chip, chosen === s.startsAt && styles.on]} onPress={() => setChosen(s.startsAt)} accessibilityRole="button">
                    <Text style={[styles.chipText, chosen === s.startsAt && styles.onText]}>{formatTime(s.startsAt)}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          )}
          <View style={styles.sheetButtons}>
            <Pressable style={[styles.btn, styles.btnOutline]} onPress={onClose} accessibilityRole="button">
              <Text style={styles.btnOutlineText}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnFill, !chosen && styles.disabled]} disabled={!chosen} onPress={() => onChosen(chosen)} accessibilityRole="button">
              <Text style={styles.btnFillText}>Confirm</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// The doctor can give a reason that the patient will read
function DeclineSheet({appointment, onClose, onDecline}) {
  const [reason, setReason] = useState('');
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Decline this request?</Text>
          <Text style={styles.muted}>{appointment.patientName} will see it as Cancelled, with your reason.</Text>
          <TextInput
            style={styles.reasonInput}
            value={reason}
            onChangeText={setReason}
            placeholder="Reason (optional), e.g. Not available that day"
            placeholderTextColor="#9AA3AF"
            multiline
            maxLength={200}
          />
          <View style={styles.sheetButtons}>
            <Pressable style={[styles.btn, styles.btnOutline]} onPress={onClose} accessibilityRole="button">
              <Text style={styles.btnOutlineText}>Keep it</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnDanger]} onPress={() => onDecline(reason.trim())} accessibilityRole="button">
              <Text style={styles.btnFillText}>Decline</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const whenText = a =>
  a.startsAt
    ? `${a.status === 'requested' ? 'Requested: ' : ''}${formatDay(a.startsAt)}, ${formatTime(a.startsAt)}`
    : a.preferredDate
    ? `Preferred: ${formatYmd(a.preferredDate)} - needs a time`
    : 'Needs a day and time';

// The doctor's requests: confirm, decline, complete
export default function DoctorAppointmentsScreen({navigation, route}) {
  const [filter, setFilter] = useState(route.params?.status ?? 'requested');
  const [items, setItems] = useState([]);
  const [state, setState] = useState('loading');
  const [timeFor, setTimeFor] = useState(null);
  const [declineFor, setDeclineFor] = useState(null);
  const [videoFor, setVideoFor] = useState(null); // {appointment, video}
  const [busy, setBusy] = useState(false);

  // the Home cards open this tab with a filter
  useEffect(() => {
    if (route.params?.status !== undefined) {
      setFilter(route.params.status);
    }
  }, [route.params?.status]);

  const load = useCallback(async () => {
    setState(prev => (prev === 'ready' ? prev : 'loading'));
    try {
      setItems((await fetchDoctorAppointments({status: filter})).items);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [filter]);

  useEffect(() => {
    load();
    return navigation.addListener('focus', load);
  }, [load, navigation]);

  const run = async work => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      Alert.alert('Appointment', error.message);
    } finally {
      setBusy(false);
      setTimeFor(null);
      setDeclineFor(null);
      load();
    }
  };

  // the gallery opens at once; then the sheet asks for the patient's agreement and uploads
  const startVideo = async a => {
    const video = await pickVideoFromGallery();
    if (video) {
      setVideoFor({appointment: a, video});
    }
  };

  const onConfirm = a => {
    if (!a.startsAt) {
      setTimeFor(a); // the patient gave no time: the doctor chooses one
      return;
    }
    Alert.alert('Confirm appointment', `${a.patientName}\n${formatDay(a.startsAt)}, ${formatTime(a.startsAt)}`, [
      {text: 'Not now', style: 'cancel'},
      {text: 'Confirm', onPress: () => run(() => confirmAppointmentAsDoctor(a.id))},
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Text style={styles.title}>Appointments</Text>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {FILTERS.map(f => (
            <Pressable key={String(f.id)} style={[styles.chip, filter === f.id && styles.on]} onPress={() => setFilter(f.id)} accessibilityRole="button">
              <Text style={[styles.chipText, filter === f.id && styles.onText]}>{f.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {state === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : state === 'error' ? (
        <EmptyState icon="cloud-off-outline" title="Could not load appointments" note="Please check your internet and try again." actionLabel="Retry" onAction={load} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={a => a.id}
          contentContainerStyle={styles.list}
          refreshing={false}
          onRefresh={load}
          ListEmptyComponent={<EmptyState icon="calendar-blank-outline" title="Nothing here" note={filter === 'requested' ? 'New requests from patients show up here.' : 'No appointments in this list.'} />}
          renderItem={({item: a}) => {
            const started = a.startsAt && new Date(a.startsAt).getTime() <= Date.now();
            return (
              <View style={styles.card}>
                <View style={styles.head}>
                  <View style={styles.headText}>
                    <Text style={styles.name} numberOfLines={1}>
                      {a.patientName}
                      {!a.forSelf ? ' (family)' : ''}
                    </Text>
                    <Pressable onPress={() => Linking.openURL(`tel:${a.patientMobile}`)} accessibilityRole="link" accessibilityLabel={`Call ${a.patientName}`}>
                      <Text style={styles.mobile}>{a.patientMobile}</Text>
                    </Pressable>
                  </View>
                  <View style={[styles.badge, a.status === 'cancelled' && styles.badgeOff, a.status === 'requested' && styles.badgeWait]}>
                    <Text style={[styles.badgeText, a.status === 'cancelled' && styles.badgeOffText, a.status === 'requested' && styles.badgeWaitText]}>{STATUS_TEXT[a.status]}</Text>
                  </View>
                </View>
                <View style={styles.line}>
                  <Icon name="calendar-clock-outline" size={16} color={colors.primary} />
                  <Text style={styles.lineText}>{whenText(a)}</Text>
                </View>
                <View style={styles.line}>
                  <Icon name={CONSULT_TYPES.find(t => t.id === a.type)?.icon ?? 'stethoscope'} size={16} color={colors.primary} />
                  <Text style={styles.lineText}>{typeLabel(a.type)}</Text>
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
                {!!a.reason && <Text style={styles.note}>“{a.reason}”</Text>}
                {a.status === 'cancelled' && !!a.cancelReason && <Text style={styles.cancelReason}>Reason: {a.cancelReason}</Text>}
                <Text style={styles.fee}>
                  {formatPrice(a.toPay)} to collect{a.creditsUsed > 0 ? ` (${a.creditsUsed} credits used)` : ''}
                </Text>

                {a.status === 'requested' && (
                  <View style={styles.actions}>
                    <Pressable style={[styles.btn, styles.btnOutline]} disabled={busy} onPress={() => setDeclineFor(a)} accessibilityRole="button" accessibilityLabel={`Decline ${a.patientName}`}>
                      <Text style={styles.btnOutlineText}>Decline</Text>
                    </Pressable>
                    <Pressable style={[styles.btn, styles.btnFill]} disabled={busy} onPress={() => onConfirm(a)} accessibilityRole="button" accessibilityLabel={`Confirm ${a.patientName}`}>
                      <Text style={styles.btnFillText}>{a.startsAt ? 'Confirm' : 'Choose time'}</Text>
                    </Pressable>
                  </View>
                )}
                {(a.status === 'booked' || a.status === 'completed') && (
                  <Pressable style={styles.videoBtn} onPress={() => startVideo(a)} accessibilityRole="button" accessibilityLabel={`Upload video for ${a.patientName}`}>
                    <Icon name="video-plus-outline" size={20} color={colors.primaryDark} />
                    <Text style={styles.videoBtnText}>Upload video</Text>
                  </Pressable>
                )}
                {a.status === 'booked' && started && (
                  <View style={styles.actions}>
                    <Pressable style={[styles.btn, styles.btnFill]} disabled={busy} onPress={() => run(() => completeAppointmentAsDoctor(a.id))} accessibilityRole="button">
                      <Text style={styles.btnFillText}>Mark completed</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          }}
        />
      )}

      {!!timeFor && <ConfirmTimeSheet appointment={timeFor} onClose={() => setTimeFor(null)} onChosen={startsAt => run(() => confirmAppointmentAsDoctor(timeFor.id, startsAt))} />}
      {!!videoFor && <VideoUploadSheet appointment={videoFor.appointment} video={videoFor.video} onClose={() => setVideoFor(null)} />}
      {!!declineFor && <DeclineSheet appointment={declineFor} onClose={() => setDeclineFor(null)} onDecline={reason => run(() => declineAppointment(declineFor.id, reason))} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.card},
  title: {fontSize: 26, fontWeight: '800', color: colors.text, paddingHorizontal: spacing.md, paddingTop: 12},
  filters: {paddingHorizontal: spacing.md, paddingVertical: 12},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  list: {padding: spacing.md, paddingTop: 0, flexGrow: 1},
  chip: {paddingHorizontal: 18, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginRight: 8, marginBottom: 8},
  chipText: {color: colors.text, fontSize: 14},
  on: {backgroundColor: colors.primaryDark, borderColor: colors.primaryDark},
  onText: {color: '#fff', fontWeight: '700'},
  card: {backgroundColor: '#fff', borderRadius: 18, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.border},
  head: {flexDirection: 'row', alignItems: 'center', marginBottom: 8},
  headText: {flex: 1, marginRight: 10},
  name: {fontWeight: '800', fontSize: 17, color: colors.text},
  mobile: {color: colors.primary, fontWeight: '600', marginTop: 2},
  badge: {backgroundColor: colors.primaryLight, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4},
  badgeText: {color: colors.primary, fontWeight: '700', fontSize: 12},
  badgeOff: {backgroundColor: '#FDECEC'},
  badgeOffText: {color: colors.danger},
  badgeWait: {backgroundColor: colors.accentLight},
  badgeWaitText: {color: colors.accent},
  line: {flexDirection: 'row', alignItems: 'center', marginTop: 4},
  lineText: {marginLeft: 8, color: colors.text, flex: 1},
  note: {color: colors.muted, fontStyle: 'italic', marginTop: 8},
  cancelReason: {color: colors.danger, marginTop: 8},
  fee: {color: colors.muted, marginTop: 10, fontSize: 13},
  actions: {flexDirection: 'row', marginTop: 12},
  videoBtn: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 12, height: 44, borderRadius: 22, backgroundColor: colors.primaryLight},
  videoBtnText: {color: colors.primaryDark, fontWeight: '700', marginLeft: 8},
  btn: {flex: 1, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center'},
  btnOutline: {borderWidth: 1.5, borderColor: colors.primaryDark, marginRight: 10, backgroundColor: '#fff'},
  btnOutlineText: {color: colors.primaryDark, fontWeight: '700'},
  btnFill: {backgroundColor: colors.primaryDark},
  btnDanger: {backgroundColor: colors.danger},
  btnFillText: {color: '#fff', fontWeight: '700'},
  disabled: {opacity: 0.5},
  backdrop: {flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end'},
  sheet: {backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.md, maxHeight: '85%'},
  sheetTitle: {fontSize: 20, fontWeight: '800', color: colors.text},
  muted: {color: colors.muted, marginTop: 4},
  days: {marginVertical: 14, flexGrow: 0},
  dayBtn: {width: 58, alignItems: 'center', paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginRight: 8},
  dayName: {fontSize: 11, color: colors.muted},
  dayNum: {fontSize: 18, fontWeight: '800', color: colors.text},
  loading: {marginVertical: 20},
  error: {color: colors.danger, marginVertical: 12},
  slotsBox: {maxHeight: 220},
  wrap: {flexDirection: 'row', flexWrap: 'wrap'},
  sheetButtons: {flexDirection: 'row', marginTop: 16},
  reasonInput: {backgroundColor: colors.card, borderRadius: 16, minHeight: 90, padding: 12, marginTop: 12, textAlignVertical: 'top', color: colors.text},
});
