import React, {useEffect, useState} from 'react';
import {Alert, Image, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useAuth} from '../context/AuthContext';
import {fetchDoctorMe} from '../services/doctorApi';
import {doctorSubtitle} from '../utils/doctor';
import {colors, formatPrice, spacing} from '../theme';

export default function DoctorAccountScreen({navigation}) {
  const {user, signOut} = useAuth();
  const [me, setMe] = useState(null);

  useEffect(() => {
    fetchDoctorMe()
      .then(setMe)
      .catch(() => setMe(null)); // the account details below still show
  }, []);

  const logOut = () =>
    Alert.alert('Log out', 'Do you want to log out?', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          navigation.reset({index: 0, routes: [{name: 'Login'}]});
        },
      },
    ]);

  const name = me?.name || user?.name || 'Doctor';
  const rows = [
    {icon: 'phone-outline', label: 'Mobile', value: user?.mobile},
    {icon: 'email-outline', label: 'Email', value: user?.email},
    {icon: 'hospital-building', label: 'Clinic', value: me?.clinicName},
    {icon: 'cash', label: 'Consultation fee', value: me ? formatPrice(me.fee) : null},
  ].filter(r => r.value);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Account</Text>
        <View style={styles.hero}>
          {me?.photoUrl ? (
            <Image source={{uri: me.photoUrl}} style={styles.avatar} />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{name.replace(/^Dr\.?\s+/i, '').charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <Text style={styles.name}>{name}</Text>
          {!!me && <Text style={styles.subtitle}>{doctorSubtitle(me)}</Text>}
        </View>

        <View style={styles.card}>
          {rows.map((r, i) => (
            <View key={r.label} style={[styles.row, i > 0 && styles.rowLine]}>
              <Icon name={r.icon} size={22} color={colors.primary} />
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>{r.label}</Text>
                <Text style={styles.rowValue}>{r.value}</Text>
              </View>
            </View>
          ))}
        </View>

        <Pressable style={styles.row2} onPress={() => navigation.navigate('DaysTimes')} accessibilityRole="button">
          <Icon name="clock-outline" size={22} color={colors.primary} />
          <Text style={styles.row2Text}>Days & times</Text>
          <Icon name="chevron-right" size={22} color={colors.muted} />
        </Pressable>

        <Pressable style={styles.logout} onPress={logOut} accessibilityRole="button">
          <Icon name="logout" size={20} color={colors.danger} />
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.card},
  content: {padding: spacing.md, paddingBottom: spacing.lg},
  title: {fontSize: 26, fontWeight: '800', color: colors.text},
  hero: {alignItems: 'center', backgroundColor: '#fff', borderRadius: 22, padding: spacing.md, marginTop: 14, borderWidth: 1, borderColor: colors.border},
  avatar: {width: 88, height: 88, borderRadius: 44, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center'},
  avatarText: {fontSize: 34, fontWeight: '800', color: colors.primaryDark},
  name: {fontSize: 22, fontWeight: '800', color: colors.text, marginTop: 10, textAlign: 'center'},
  subtitle: {color: colors.muted, marginTop: 4, textAlign: 'center'},
  card: {backgroundColor: '#fff', borderRadius: 18, marginTop: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14},
  row: {flexDirection: 'row', alignItems: 'center', paddingVertical: 14},
  rowLine: {borderTopWidth: 1, borderTopColor: colors.border},
  rowText: {marginLeft: 12, flex: 1},
  rowLabel: {color: colors.muted, fontSize: 12},
  rowValue: {color: colors.text, fontSize: 16, marginTop: 2},
  row2: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 18, marginTop: 14, padding: 16, borderWidth: 1, borderColor: colors.border},
  row2Text: {flex: 1, marginLeft: 12, fontSize: 16, color: colors.text},
  logout: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 24, height: 50, borderRadius: 25, borderWidth: 1.5, borderColor: colors.danger},
  logoutText: {color: colors.danger, fontWeight: '800', marginLeft: 8, fontSize: 16},
});
