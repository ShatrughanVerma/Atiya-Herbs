import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DoctorAvatar from '../../components/consult/DoctorAvatar';
import EmptyState from '../../components/shop/EmptyState';
import ScreenHeader from '../../components/shop/ScreenHeader';
import {fetchDoctor} from '../../services/consultApi';
import {CONSULT_TYPES, formatNextSlot, summarizeTimings} from '../../utils/consult';
import {colors, formatPrice, spacing} from '../../theme';

export default function DoctorDetailScreen({navigation, route}) {
  const {id} = route.params;
  const [doctor, setDoctor] = useState(null);
  const [status, setStatus] = useState('loading');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setDoctor(await fetchDoctor(id));
      setStatus('ready');
    } catch (error) {
      setStatus(error.kind === 'not-found' ? 'missing' : 'error');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (status !== 'ready') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <ScreenHeader title="Doctor" navigation={navigation} />
        {status === 'loading' ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : status === 'missing' ? (
          <EmptyState icon="account-search-outline" title="Doctor not found" note="This doctor is not available any more." />
        ) : (
          <EmptyState icon="cloud-off-outline" title="Could not load the doctor" note="Please check your internet and try again." actionLabel="Retry" onAction={load} />
        )}
      </SafeAreaView>
    );
  }

  const timings = summarizeTimings(doctor.weeklyTimings);
  const clinic = doctor.clinic;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader title="Doctor" navigation={navigation} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <DoctorAvatar doctor={doctor} size={88} />
          <Text style={styles.name}>{doctor.name}</Text>
          <Text style={styles.spec}>{[doctor.system, doctor.specialization].filter(Boolean).join(' · ')}</Text>
          {!!doctor.qualifications && <Text style={styles.muted}>{doctor.qualifications}</Text>}
        </View>

        <View style={styles.stats}>
          <Stat label="Experience" value={doctor.experienceYears ? `${doctor.experienceYears} yrs` : '-'} />
          <Stat label="Rating" value={doctor.reviewCount > 0 ? doctor.rating.toFixed(1) : 'New'} />
          <Stat label="Reviews" value={String(doctor.reviewCount)} />
          <Stat label="Fee" value={formatPrice(doctor.fee)} />
        </View>

        {!!doctor.nextAvailable && (
          <View style={styles.nextBox}>
            <Icon name="clock-outline" size={18} color={colors.primary} />
            <Text style={styles.nextText}>Next available: {formatNextSlot(doctor.nextAvailable)}</Text>
          </View>
        )}

        {doctor.concerns.length > 0 && (
          <Section title="Treats">
            <View style={styles.modes}>
              {doctor.concerns.map(c => (
                <View key={c} style={styles.mode}>
                  <Text style={styles.modeText}>{c}</Text>
                </View>
              ))}
            </View>
          </Section>
        )}

        {!!doctor.bio && (
          <Section title="About">
            <Text style={styles.body}>{doctor.bio}</Text>
          </Section>
        )}

        <Section title="Consultation options">
          <View style={styles.modes}>
            {CONSULT_TYPES.filter(type => doctor.modes.includes(type.id)).map(type => (
              <View key={type.id} style={styles.mode}>
                <Icon name={type.icon} size={18} color={colors.primary} />
                <Text style={styles.modeText}>{type.label}</Text>
              </View>
            ))}
          </View>
        </Section>

        {!!doctor.languages && (
          <Section title="Languages">
            <Text style={styles.body}>{doctor.languages}</Text>
          </Section>
        )}

        {timings.length > 0 && (
          <Section title="Timings">
            {timings.map(line => (
              <Text key={line} style={styles.body}>
                {line}
              </Text>
            ))}
          </Section>
        )}

        {!!clinic && (
          <Section title="Clinic">
            <Text style={styles.clinicName}>{clinic.name}</Text>
            {!!clinic.address && <Text style={styles.body}>{clinic.address}</Text>}
            {!!clinic.timings && <Text style={styles.body}>{clinic.timings}</Text>}
            {!!clinic.phone && (
              <Pressable onPress={() => Linking.openURL(`tel:${clinic.phone}`)} accessibilityRole="link">
                <Text style={styles.link}>{clinic.phone}</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${clinic.lat},${clinic.lng}`)}
              accessibilityRole="link">
              <Text style={styles.link}>Get directions</Text>
            </Pressable>
          </Section>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.bookBtn} onPress={() => navigation.navigate('BookAppointment', {id: doctor.id})} accessibilityRole="button">
          <Text style={styles.bookText}>Book appointment</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const Stat = ({label, value}) => (
  <View style={styles.stat}>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const Section = ({title, children}) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>
);

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.card},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  content: {padding: spacing.md},
  hero: {alignItems: 'center', backgroundColor: colors.background, borderRadius: 14, padding: spacing.md, borderWidth: 1, borderColor: colors.border},
  name: {fontSize: 20, fontWeight: '800', color: colors.text, marginTop: 10, textAlign: 'center'},
  spec: {color: colors.primary, fontWeight: '700', marginTop: 2},
  muted: {color: colors.muted, marginTop: 2, textAlign: 'center'},
  stats: {flexDirection: 'row', backgroundColor: colors.background, borderRadius: 14, marginTop: 12, borderWidth: 1, borderColor: colors.border},
  stat: {flex: 1, alignItems: 'center', paddingVertical: 12},
  statValue: {fontWeight: '800', color: colors.text, fontSize: 15},
  statLabel: {color: colors.muted, fontSize: 11, marginTop: 2},
  nextBox: {flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primaryLight, borderRadius: 14, padding: 12, marginTop: 12},
  nextText: {marginLeft: 8, color: colors.primaryDark, fontWeight: '700'},
  section: {backgroundColor: colors.background, borderRadius: 14, padding: 14, marginTop: 12, borderWidth: 1, borderColor: colors.border},
  sectionTitle: {fontWeight: '800', color: colors.text, marginBottom: 6},
  body: {color: colors.text, lineHeight: 20},
  modes: {flexDirection: 'row', flexWrap: 'wrap'},
  mode: {flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primaryLight, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8, marginBottom: 6},
  modeText: {color: colors.primary, fontWeight: '700', marginLeft: 6, fontSize: 13},
  clinicName: {fontWeight: '700', color: colors.text, marginBottom: 2},
  link: {color: colors.primary, fontWeight: '700', marginTop: 6},
  footer: {padding: spacing.md, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border},
  bookBtn: {backgroundColor: colors.accent, borderRadius: 24, height: 48, alignItems: 'center', justifyContent: 'center'},
  bookText: {color: '#fff', fontWeight: '800', fontSize: 16},
});
