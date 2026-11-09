import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import MonthCalendar from '../../components/consult/MonthCalendar';
import EmptyState from '../../components/shop/EmptyState';
import ScreenHeader from '../../components/shop/ScreenHeader';
import {useAuth} from '../../context/AuthContext';
import {bookAppointment, fetchClinics, fetchCredits, fetchDoctors, fetchSlots} from '../../services/consultApi';
import {CONSULT_TYPES, DURATIONS, HEALTH_CONCERNS, formatDay, formatTime, formatYmd, todayYmd, upcomingDays} from '../../utils/consult';
import {colors, formatPrice, spacing} from '../../theme';

const MOBILE = /^[6-9][0-9]{9}$/;

const Chip = ({label, on, onPress}) => (
  <Pressable style={[styles.chip, on && styles.chipOn]} onPress={onPress} accessibilityRole="button" accessibilityState={{selected: on}}>
    <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
  </Pressable>
);

const Label = ({children}) => <Text style={styles.heading}>{children}</Text>;

// Ask for an appointment. The person picks the clinic, how they want to meet, who it is for, the problem and a
// day. A day with a time they like books it at once; "Any day" (or no time) is a request the clinic answers.
export default function BookAppointmentScreen({navigation, route}) {
  const {user} = useAuth();
  const today = useMemo(() => todayYmd(), []);
  const lastDay = useMemo(() => upcomingDays(31).pop().ymd, []);

  const [doctors, setDoctors] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [doctorId, setDoctorId] = useState(route.params.id);
  const [loadError, setLoadError] = useState(false);

  const [type, setType] = useState(null);
  const [typeOpen, setTypeOpen] = useState(false);
  const [forSelf, setForSelf] = useState(true);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [city, setCity] = useState('');
  const [concern, setConcern] = useState('');
  const [duration, setDuration] = useState(null);
  const [dayMode, setDayMode] = useState('any'); // any | today | pick
  const [pickedDay, setPickedDay] = useState(null);
  const [slots, setSlots] = useState([]);
  const [slotsStatus, setSlotsStatus] = useState('idle'); // idle | loading | ready | error
  const [slot, setSlot] = useState(null);
  const [credits, setCredits] = useState(0);
  const [useCredits, setUseCredits] = useState(false);
  const [note, setNote] = useState('');
  const [noteTouched, setNoteTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([fetchDoctors({pageSize: 50}), fetchClinics()])
      .then(([res, list]) => {
        setDoctors(res.items);
        setClinics(list);
      })
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    if (user) {
      fetchCredits()
        .then(res => setCredits(res.balance))
        .catch(() => setCredits(0));
    }
  }, [user]);

  // The form starts with the person's own name and mobile number
  useEffect(() => {
    if (forSelf) {
      setName(user?.name || '');
      setMobile(user?.mobile || '');
    } else {
      setName('');
      setMobile('');
    }
  }, [forSelf, user]);

  const doctor = doctors.find(d => d.id === doctorId) || null;
  const clinicChoices = useMemo(() => {
    const withDoctors = new Set(doctors.map(d => d.clinic?.id).filter(Boolean));
    return clinics.filter(c => withDoctors.has(c.id));
  }, [doctors, clinics]);
  const clinic = clinics.find(c => c.id === doctor?.clinic?.id) || null;

  // The kinds of consultation this doctor offers; the clinic visit first, like the design
  const types = CONSULT_TYPES.filter(t => doctor?.modes.includes(t.id));
  useEffect(() => {
    if (doctor && !types.some(t => t.id === type)) {
      setType(types[0]?.id ?? null);
    }
  }, [doctor, types, type]);
  const chosenType = types.find(t => t.id === type) || null;

  useEffect(() => {
    if (doctor && !noteTouched) {
      setNote(`Consultation with ${doctor.name}`);
    }
  }, [doctor, noteTouched]);

  const day = dayMode === 'today' ? today : dayMode === 'pick' ? pickedDay : null;

  const loadSlots = useCallback(async () => {
    if (!day || !doctorId) {
      setSlotsStatus('idle');
      return;
    }
    setSlotsStatus('loading');
    setSlot(null);
    try {
      setSlots((await fetchSlots(doctorId, day)).slots);
      setSlotsStatus('ready');
    } catch {
      setSlotsStatus('error');
    }
  }, [day, doctorId]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  const creditsToUse = useCredits && doctor ? Math.min(credits, doctor.fee) : 0;

  const submit = async () => {
    if (!user) {
      navigation.navigate('Login');
      return;
    }
    if (name.trim().length < 2) {
      Alert.alert('Appointment', 'Please enter the patient name.');
      return;
    }
    if (!forSelf && !MOBILE.test(mobile)) {
      Alert.alert('Appointment', 'Please enter a valid 10-digit mobile number.');
      return;
    }
    setSaving(true);
    try {
      const appointment = await bookAppointment({
        doctorId,
        type,
        startsAt: slot,
        preferredDate: day,
        forSelf,
        patientName: name.trim(),
        patientMobile: forSelf ? undefined : mobile,
        city: city.trim(),
        concern: concern.trim(),
        duration,
        reason: note.trim(),
        useCredits,
      });
      const when = appointment.startsAt
        ? `Requested time: ${formatDay(appointment.startsAt)}, ${formatTime(appointment.startsAt)}`
        : appointment.preferredDate
        ? `Preferred day: ${formatYmd(appointment.preferredDate)}. The doctor will suggest a time.`
        : 'The doctor will suggest a day and time.';
      Alert.alert('Request sent', `${doctor.name}\n${when}\n\nStatus: Pending. The doctor will confirm it, and you will see it in My Appointments.\n\nBooking no. ${appointment.number}`, [
        {text: 'View my appointments', onPress: () => navigation.replace('Appointments')},
      ]);
    } catch (error) {
      Alert.alert('Appointment', error.message);
      if (error.kind === 'conflict') {
        loadSlots(); // the time may be gone: show the fresh list
      }
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <ScreenHeader title="Book Appointment" navigation={navigation} />
        <EmptyState icon="cloud-off-outline" title="Could not load the doctor" note="Please go back and try again." />
      </SafeAreaView>
    );
  }
  if (!doctor) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <ScreenHeader title="Book Appointment" navigation={navigation} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  const canSubmit = !!type && !saving;
  const dayCaption =
    dayMode === 'any'
      ? 'Any day - the clinic will suggest one'
      : day
      ? `${formatYmd(day)}${slot ? `, ${formatTime(slot)}` : ' - pick a time below, or let the clinic suggest one'}`
      : 'Choose a day on the calendar';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader title="Book Appointment" navigation={navigation} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Label>Clinic</Label>
          <View style={styles.wrap}>
            {clinicChoices.map(c => (
              <Chip
                key={c.id}
                label={c.area}
                on={c.id === clinic?.id}
                onPress={() => {
                  const next = doctors.find(d => d.clinic?.id === c.id);
                  if (next) {
                    setDoctorId(next.id);
                    setSlot(null);
                  }
                }}
              />
            ))}
          </View>
          <View style={styles.clinicBox}>
            <Text style={styles.clinicName}>{clinic?.name ?? 'Online consultation'}</Text>
            {!!clinic?.address && <Text style={styles.clinicText}>{clinic.address}</Text>}
            <Text style={styles.clinicText}>Consulting doctor: {doctor.name}</Text>
          </View>

          <Label>Appointment type</Label>
          <Pressable style={styles.typeCard} onPress={() => setTypeOpen(open => !open)} accessibilityRole="button" accessibilityLabel="Choose appointment type">
            <View style={styles.typeIcon}>
              <Icon name={chosenType?.icon ?? 'stethoscope'} size={26} color={colors.primary} />
            </View>
            <View style={styles.typeText}>
              <Text style={styles.typeTitle}>{chosenType?.title ?? 'Consultation'}</Text>
              <Text style={styles.typeNote}>{chosenType?.note}</Text>
            </View>
            <Text style={styles.typeFee}>{formatPrice(doctor.fee)}</Text>
            <Icon name={typeOpen ? 'chevron-up' : 'chevron-down'} size={24} color={colors.text} />
          </Pressable>
          {typeOpen &&
            types
              .filter(t => t.id !== type)
              .map(t => (
                <Pressable
                  key={t.id}
                  style={styles.typeOption}
                  onPress={() => {
                    setType(t.id);
                    setTypeOpen(false);
                  }}
                  accessibilityRole="button">
                  <Icon name={t.icon} size={22} color={colors.primary} />
                  <View style={styles.typeText}>
                    <Text style={styles.typeTitle}>{t.title}</Text>
                    <Text style={styles.typeNote}>{t.note}</Text>
                  </View>
                  <Text style={styles.typeFee}>{formatPrice(doctor.fee)}</Text>
                </Pressable>
              ))}

          <Label>Who is the appointment for?</Label>
          <View style={styles.wrap}>
            <Chip label="Myself" on={forSelf} onPress={() => setForSelf(true)} />
            <Chip label="+ Family member" on={!forSelf} onPress={() => setForSelf(false)} />
          </View>
          <Text style={styles.fieldLabel}>Patient name</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor="#9AA3AF" maxLength={100} />
          <Text style={styles.fieldLabel}>Mobile number</Text>
          <TextInput
            style={[styles.input, forSelf && styles.inputLocked]}
            value={mobile}
            onChangeText={text => setMobile(text.replace(/\D/g, '').slice(0, 10))}
            editable={!forSelf}
            keyboardType="number-pad"
            placeholder="10-digit mobile number"
            placeholderTextColor="#9AA3AF"
          />
          <Text style={styles.fieldLabel}>Your city (optional)</Text>
          <TextInput style={styles.input} value={city} onChangeText={setCity} placeholder="e.g. Lucknow" placeholderTextColor="#9AA3AF" maxLength={80} />

          <Label>Health concern</Label>
          <View style={styles.wrap}>
            {HEALTH_CONCERNS.map(c => (
              <Chip key={c} label={c} on={concern === c} onPress={() => setConcern(concern === c ? '' : c)} />
            ))}
          </View>
          <TextInput
            style={[styles.input, styles.gap]}
            value={concern}
            onChangeText={setConcern}
            placeholder="Or type your concern"
            placeholderTextColor="#9AA3AF"
            maxLength={200}
          />

          <Label>How long have you had it?</Label>
          <View style={styles.wrap}>
            {DURATIONS.map(d => (
              <Chip key={d} label={d} on={duration === d} onPress={() => setDuration(duration === d ? null : d)} />
            ))}
          </View>

          <Label>Preferred date</Label>
          <View style={styles.wrap}>
            <Chip label="Any day" on={dayMode === 'any'} onPress={() => setDayMode('any')} />
            <Chip label="Today" on={dayMode === 'today'} onPress={() => setDayMode('today')} />
            <Chip
              label="Pick a date"
              on={dayMode === 'pick'}
              onPress={() => {
                setDayMode('pick');
                setPickedDay(prev => prev ?? today);
              }}
            />
          </View>
          {dayMode === 'pick' && (
            <MonthCalendar
              selected={pickedDay}
              minYmd={today}
              maxYmd={lastDay}
              onSelect={ymd => {
                setPickedDay(ymd);
                setSlot(null);
              }}
            />
          )}
          <View style={styles.caption}>
            <Icon name="calendar-blank-outline" size={22} color={colors.primaryDark} />
            <Text style={styles.captionText}>{dayCaption}</Text>
          </View>

          <Label>Time</Label>
          {!day ? (
            <Text style={styles.muted}>Pick a date to see {doctor.name}&apos;s free times.</Text>
          ) : slotsStatus === 'loading' ? (
            <ActivityIndicator color={colors.primary} style={styles.slotsLoading} />
          ) : slotsStatus === 'error' ? (
            <Pressable onPress={loadSlots}>
              <Text style={styles.retry}>Could not load times. Tap to retry.</Text>
            </Pressable>
          ) : slots.length === 0 ? (
            <Text style={styles.muted}>No free times on this day. Pick another date, or send the request and the clinic will suggest one.</Text>
          ) : (
            <View style={styles.wrap}>
              {slots.map(s => (
                <Chip key={s.startsAt} label={formatTime(s.startsAt)} on={slot === s.startsAt} onPress={() => setSlot(slot === s.startsAt ? null : s.startsAt)} />
              ))}
            </View>
          )}

          {!!user && (
            <Pressable style={styles.creditRow} onPress={() => credits > 0 && setUseCredits(on => !on)} accessibilityRole="checkbox" accessibilityState={{checked: useCredits, disabled: credits <= 0}}>
              <View style={[styles.checkbox, useCredits && styles.checkboxOn, credits <= 0 && styles.checkboxOff]}>
                {useCredits && <Icon name="check" size={18} color="#fff" />}
              </View>
              <View style={styles.creditText}>
                <Text style={styles.creditTitle}>Use my credits ({credits} available)</Text>
                <Text style={styles.muted}>1 credit = {formatPrice(1)} off the consultation fee</Text>
              </View>
            </Pressable>
          )}

          <Text style={styles.fieldLabel}>Anything else? (optional)</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={note}
            onChangeText={text => {
              setNote(text);
              setNoteTouched(true);
            }}
            multiline
            maxLength={500}
            placeholderTextColor="#9AA3AF"
          />
        </ScrollView>

        <View style={styles.footer}>
          {creditsToUse > 0 && (
            <Text style={styles.payNote}>
              {formatPrice(doctor.fee)} - {creditsToUse} credits = pay {formatPrice(doctor.fee - creditsToUse)} at the consultation
            </Text>
          )}
          <Pressable style={[styles.submit, !canSubmit && styles.disabled]} disabled={!canSubmit} onPress={submit} accessibilityRole="button">
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>{!user ? 'Log in to continue' : 'Request appointment'}</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background},
  flex: {flex: 1},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  content: {padding: spacing.md, paddingBottom: spacing.lg},
  heading: {fontSize: 22, fontWeight: '800', color: colors.text, marginTop: 24, marginBottom: 12},
  wrap: {flexDirection: 'row', flexWrap: 'wrap'},
  chip: {paddingHorizontal: 20, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', marginRight: 10, marginBottom: 10},
  chipOn: {backgroundColor: colors.primaryDark, borderColor: colors.primaryDark},
  chipText: {color: colors.text, fontSize: 15},
  chipTextOn: {color: '#fff', fontWeight: '600'},
  clinicBox: {backgroundColor: colors.cream, borderRadius: 16, padding: 16, marginTop: 4},
  clinicName: {color: colors.primaryDark, fontSize: 18, fontWeight: '700'},
  clinicText: {color: colors.text, marginTop: 4, lineHeight: 21},
  typeCard: {flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14, backgroundColor: colors.background},
  typeOption: {flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14, marginTop: 8},
  typeIcon: {width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center'},
  typeText: {flex: 1, marginHorizontal: 12},
  typeTitle: {fontWeight: '700', fontSize: 17, color: colors.text},
  typeNote: {color: colors.muted, marginTop: 2, lineHeight: 20},
  typeFee: {fontSize: 18, fontWeight: '700', color: colors.text, marginRight: 6},
  fieldLabel: {color: colors.muted, marginTop: 14, marginBottom: 6, marginLeft: 4},
  input: {backgroundColor: colors.card, borderRadius: 24, paddingHorizontal: 18, minHeight: 52, color: colors.text, fontSize: 17},
  inputLocked: {color: colors.muted},
  gap: {marginTop: 2},
  multiline: {borderRadius: 20, minHeight: 100, paddingTop: 14, textAlignVertical: 'top'},
  caption: {flexDirection: 'row', alignItems: 'center', marginTop: 14},
  captionText: {marginLeft: 10, color: colors.muted, flex: 1, fontSize: 15},
  muted: {color: colors.muted, lineHeight: 20},
  slotsLoading: {alignSelf: 'flex-start', marginVertical: 10},
  retry: {color: colors.danger, fontWeight: '600'},
  creditRow: {flexDirection: 'row', alignItems: 'center', marginTop: 22},
  checkbox: {width: 36, height: 36, borderRadius: 8, borderWidth: 2, borderColor: colors.muted, alignItems: 'center', justifyContent: 'center'},
  checkboxOn: {backgroundColor: colors.primaryDark, borderColor: colors.primaryDark},
  checkboxOff: {opacity: 0.4},
  creditText: {flex: 1, marginLeft: 14},
  creditTitle: {fontSize: 17, fontWeight: '600', color: colors.text},
  footer: {padding: spacing.md, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border},
  payNote: {textAlign: 'center', color: colors.primaryDark, fontWeight: '600', marginBottom: 8},
  submit: {backgroundColor: colors.primaryDark, borderRadius: 28, height: 56, alignItems: 'center', justifyContent: 'center'},
  submitText: {color: '#fff', fontWeight: '800', fontSize: 18},
  disabled: {opacity: 0.5},
});
