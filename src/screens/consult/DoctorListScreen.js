import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DoctorAvatar from '../../components/consult/DoctorAvatar';
import EmptyState from '../../components/shop/EmptyState';
import {fetchConcerns, fetchDoctors} from '../../services/consultApi';
import {formatNextSlot} from '../../utils/consult';
import {colors, formatPrice, spacing} from '../../theme';

// "BUMS, MD (Unani) · Unani · Digestive wellness · 18 yrs"
const subtitle = d =>
  [d.qualifications, d.system, d.specialization, d.experienceYears ? `${d.experienceYears} yrs` : null].filter(Boolean).join(' · ');

export function DoctorCard({doctor, onProfile, onBook}) {
  const next = formatNextSlot(doctor.nextAvailable);
  const meta = [doctor.languages, doctor.clinic?.name].filter(Boolean).join(' · ');
  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <DoctorAvatar doctor={doctor} size={96} square />
        <View style={styles.topText}>
          <Text style={styles.name} numberOfLines={1}>
            {doctor.name}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle(doctor)}
          </Text>
          <View style={styles.ratingRow}>
            <Icon name="star" size={16} color={colors.star} />
            <Text style={styles.rating}>{doctor.rating.toFixed(1)}</Text>
            {next ? (
              <Text style={styles.next} numberOfLines={1}>
                {next}
              </Text>
            ) : (
              <Text style={styles.noSlot} numberOfLines={1}>
                No slot soon
              </Text>
            )}
          </View>
        </View>
      </View>
      {!!meta && (
        <Text style={styles.meta} numberOfLines={2}>
          {meta}
        </Text>
      )}
      <Text style={styles.fee}>
        {formatPrice(doctor.fee)} <Text style={styles.feeNote}>consultation</Text>
      </Text>
      <View style={styles.buttons}>
        <Pressable style={[styles.btn, styles.btnOutline]} onPress={onProfile} accessibilityRole="button" accessibilityLabel={`View profile of ${doctor.name}`}>
          <Text style={styles.btnOutlineText}>View Profile</Text>
        </Pressable>
        <Pressable style={[styles.btn, styles.btnFill]} onPress={onBook} accessibilityRole="button" accessibilityLabel={`Book consult with ${doctor.name}`}>
          <Text style={styles.btnFillText}>Book Consult</Text>
        </Pressable>
      </View>
    </View>
  );
}

// The doctor list. It is also the "Clinics" tab, so people land here to find a doctor.
export default function DoctorListScreen({navigation}) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [concern, setConcern] = useState(null);
  const [concerns, setConcerns] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error

  // Search while typing, but wait a moment so every key press does not hit the server
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 350);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    fetchConcerns()
      .then(setConcerns)
      .catch(() => setConcerns([])); // the list still works without the chips
  }, []);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await fetchDoctors({q: query, concern});
      setDoctors(res.items);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [query, concern]);

  useEffect(() => {
    load();
  }, [load]);

  const header = (
    <View>
      <Text style={styles.eyebrow}>MEET OUR DOCTORS</Text>
      <Text style={styles.title}>Consult a specialist</Text>
      <View style={styles.searchWrap}>
        <Icon name="magnify" size={24} color={colors.muted} />
        <TextInput
          style={styles.search}
          value={text}
          onChangeText={setText}
          placeholder="Search doctors, concerns..."
          placeholderTextColor="#9AA3AF"
          returnKeyType="search"
          accessibilityLabel="Search doctors"
        />
        {!!text && (
          <Pressable onPress={() => setText('')} hitSlop={8} accessibilityLabel="Clear search">
            <Icon name="close-circle" size={18} color={colors.muted} />
          </Pressable>
        )}
      </View>

      <View style={styles.tiles}>
        <Pressable style={[styles.tile, styles.tileGap]} onPress={() => navigation.navigate('Appointments')} accessibilityRole="button">
          <View style={styles.tileIcon}>
            <Icon name="calendar-month-outline" size={28} color="#fff" />
          </View>
          <Text style={styles.tileTitle}>My appointments</Text>
          <Text style={styles.tileNote}>Upcoming and past consults</Text>
        </Pressable>
        <Pressable style={styles.tile} onPress={() => navigation.navigate('FindClinic')} accessibilityRole="button">
          <View style={styles.tileIcon}>
            <Icon name="map-marker-outline" size={28} color="#fff" />
          </View>
          <Text style={styles.tileTitle}>Find a clinic</Text>
          <Text style={styles.tileNote}>Nearest to you, with directions</Text>
        </Pressable>
      </View>

      {concerns.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {[null, ...concerns].map(c => (
            <Pressable key={c ?? 'all'} style={[styles.chip, concern === c && styles.chipOn]} onPress={() => setConcern(c)} accessibilityRole="button">
              <Text style={[styles.chipText, concern === c && styles.chipTextOn]}>{c ?? 'All'}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {status === 'error' && doctors.length === 0 ? (
        <>
          {header}
          <EmptyState icon="cloud-off-outline" title="Could not load doctors" note="Please check your internet and try again." actionLabel="Retry" onAction={load} />
        </>
      ) : (
        <FlatList
          data={doctors}
          keyExtractor={d => d.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshing={status === 'loading' && doctors.length > 0}
          onRefresh={load}
          ListHeaderComponent={header}
          ListEmptyComponent={
            status === 'loading' ? (
              <ActivityIndicator color={colors.primary} size="large" style={styles.loading} />
            ) : (
              <View style={styles.emptyWrap}>
                <EmptyState icon="stethoscope" title="No doctors found" note="Try another name or concern." />
              </View>
            )
          }
          renderItem={({item}) => (
            <DoctorCard
              doctor={item}
              onProfile={() => navigation.navigate('DoctorDetail', {id: item.id})}
              onBook={() => navigation.navigate('BookAppointment', {id: item.id})}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const SHADOW = {shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: {width: 0, height: 2}, elevation: 3};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background},
  list: {padding: spacing.md, paddingBottom: spacing.lg, flexGrow: 1},
  eyebrow: {color: colors.primaryDark, fontWeight: '600', letterSpacing: 2, fontSize: 13, marginTop: 8},
  title: {fontSize: 30, fontWeight: '800', color: colors.text, marginTop: 4},
  searchWrap: {flexDirection: 'row', alignItems: 'center', backgroundColor: colors.background, marginTop: 18, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1, borderColor: colors.border, ...SHADOW},
  search: {flex: 1, minHeight: 54, marginLeft: 10, color: colors.text, fontSize: 16},
  tiles: {flexDirection: 'row', marginTop: 18},
  tile: {flex: 1, backgroundColor: colors.primaryLight, borderRadius: 20, padding: 16, minHeight: 132},
  tileGap: {marginRight: 12},
  tileIcon: {width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center'},
  tileTitle: {fontSize: 17, fontWeight: '700', color: colors.text, marginTop: 14},
  tileNote: {color: colors.muted, marginTop: 4, lineHeight: 19},
  chips: {paddingVertical: 18},
  chip: {paddingHorizontal: 20, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.border, marginRight: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background},
  chipOn: {backgroundColor: colors.primaryDark, borderColor: colors.primaryDark},
  chipText: {color: colors.text, fontSize: 15},
  chipTextOn: {color: '#fff', fontWeight: '700'},
  loading: {marginTop: 40},
  emptyWrap: {height: 260},
  card: {backgroundColor: colors.background, borderRadius: 22, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: colors.border, ...SHADOW},
  top: {flexDirection: 'row'},
  topText: {flex: 1, marginLeft: 14, justifyContent: 'center'},
  name: {fontSize: 20, fontWeight: '800', color: colors.text},
  subtitle: {color: colors.muted, marginTop: 4},
  ratingRow: {flexDirection: 'row', alignItems: 'center', marginTop: 8},
  rating: {marginLeft: 4, marginRight: 10, fontWeight: '700', color: colors.text},
  next: {flex: 1, color: colors.primary, fontWeight: '700'},
  noSlot: {flex: 1, color: colors.muted},
  meta: {color: colors.muted, marginTop: 12, fontSize: 15},
  fee: {fontSize: 26, fontWeight: '800', color: colors.text, marginTop: 10},
  feeNote: {fontSize: 15, fontWeight: '400', color: colors.muted},
  buttons: {flexDirection: 'row', marginTop: 14},
  btn: {flex: 1, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center'},
  btnOutline: {borderWidth: 1.5, borderColor: colors.primaryDark, marginRight: 12},
  btnOutlineText: {color: colors.primaryDark, fontWeight: '700', fontSize: 15},
  btnFill: {backgroundColor: colors.primaryDark},
  btnFillText: {color: '#fff', fontWeight: '700', fontSize: 15},
});
