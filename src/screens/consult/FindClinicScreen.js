import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, FlatList, Linking, Pressable, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import EmptyState from '../../components/shop/EmptyState';
import ScreenHeader from '../../components/shop/ScreenHeader';
import {fetchClinics} from '../../services/consultApi';
import {getCurrentLocation} from '../../utils/location';
import {colors, spacing} from '../../theme';

const formatDistance = km => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`);

// All clinics from the server. "Use my location" sorts them by distance from the person.
export default function FindClinicScreen({navigation}) {
  const [clinics, setClinics] = useState([]);
  const [status, setStatus] = useState('loading');
  const [near, setNear] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');

  const load = useCallback(async position => {
    setStatus('loading');
    try {
      setClinics(await fetchClinics(position ?? {}));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const useMyLocation = async () => {
    setLocating(true);
    setLocationError('');
    try {
      const position = await getCurrentLocation();
      await load(position);
      setNear(true);
    } catch (error) {
      setLocationError(error.message);
    } finally {
      setLocating(false);
    }
  };

  const openMap = clinic =>
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${clinic.lat},${clinic.lng}`);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader title="Find a clinic" navigation={navigation} />
      <Pressable style={styles.locate} onPress={useMyLocation} disabled={locating} accessibilityRole="button">
        {locating ? <ActivityIndicator color={colors.primary} /> : <Icon name="crosshairs-gps" size={20} color={colors.primary} />}
        <Text style={styles.locateText}>{near ? 'Showing the clinics nearest to you' : 'Use my location to find the nearest clinic'}</Text>
      </Pressable>
      {!!locationError && <Text style={styles.error}>{locationError}</Text>}

      {status === 'loading' && clinics.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : status === 'error' && clinics.length === 0 ? (
        <EmptyState icon="cloud-off-outline" title="Could not load clinics" note="Please check your internet and try again." actionLabel="Retry" onAction={() => load()} />
      ) : (
        <FlatList
          data={clinics}
          keyExtractor={c => c.id}
          contentContainerStyle={styles.list}
          renderItem={({item: clinic, index}) => (
            <View style={styles.card}>
              <View style={styles.head}>
                <View style={styles.pin}>
                  <Icon name="map-marker" size={22} color="#fff" />
                </View>
                <View style={styles.headText}>
                  <Text style={styles.name}>{clinic.name}</Text>
                  <Text style={styles.muted}>
                    {clinic.area}
                    {clinic.distanceKm !== undefined ? ` · ${formatDistance(clinic.distanceKm)} away` : ''}
                  </Text>
                </View>
                {near && index === 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>Nearest</Text>
                  </View>
                )}
              </View>
              {!!clinic.address && <Text style={styles.address}>{clinic.address}</Text>}
              {!!clinic.timings && <Text style={styles.muted}>{clinic.timings}</Text>}
              <View style={styles.actions}>
                <Pressable style={styles.action} onPress={() => openMap(clinic)} accessibilityRole="button" accessibilityLabel={`Directions to ${clinic.name}`}>
                  <Icon name="directions" size={18} color={colors.primaryDark} />
                  <Text style={styles.actionText}>Directions</Text>
                </Pressable>
                {!!clinic.phone && (
                  <Pressable style={styles.action} onPress={() => Linking.openURL(`tel:${clinic.phone}`)} accessibilityRole="button" accessibilityLabel={`Call ${clinic.name}`}>
                    <Icon name="phone-outline" size={18} color={colors.primaryDark} />
                    <Text style={styles.actionText}>Call</Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.card},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  locate: {flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primaryLight, margin: spacing.md, marginBottom: spacing.sm, padding: 14, borderRadius: 14},
  locateText: {marginLeft: 10, color: colors.primaryDark, fontWeight: '700', flex: 1},
  error: {color: colors.danger, marginHorizontal: spacing.md, marginBottom: 6},
  list: {padding: spacing.md, paddingTop: spacing.sm},
  card: {backgroundColor: colors.background, borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.border},
  head: {flexDirection: 'row', alignItems: 'center'},
  pin: {width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center'},
  headText: {flex: 1, marginHorizontal: 12},
  name: {fontWeight: '800', fontSize: 16, color: colors.text},
  muted: {color: colors.muted, marginTop: 2},
  address: {color: colors.text, marginTop: 10, lineHeight: 20},
  badge: {backgroundColor: colors.accentLight, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4},
  badgeText: {color: colors.accent, fontWeight: '700', fontSize: 12},
  actions: {flexDirection: 'row', marginTop: 12},
  action: {flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.primaryDark, borderRadius: 20, paddingHorizontal: 14, height: 38, marginRight: 10},
  actionText: {color: colors.primaryDark, fontWeight: '700', marginLeft: 6},
});
