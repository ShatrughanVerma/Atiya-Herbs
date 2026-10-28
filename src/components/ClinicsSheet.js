import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {PAGES} from '../data/store';
import {colors, spacing} from '../theme';
import {isValidPincode, searchByPincode, sortClinics} from '../utils/clinicSearch';
import {getCurrentLocation} from '../utils/location';

const CREAM = '#FFF9EC';
const CREAM_BORDER = '#EFE2C4';

const formatKm = km => (km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`);

const openLink = url => Linking.openURL(url).catch(() => Alert.alert('Could not open', 'Please try again later.'));

const directionsUrl = clinic =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    clinic.address || `${clinic.lat},${clinic.lng}`,
  )}`;

function SelectedClinic({clinic, km, from}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardName}>{clinic.name}</Text>
      <Text style={styles.cardArea}>{clinic.area}</Text>
      {!!clinic.address && <Text style={styles.cardAddress}>{clinic.address}</Text>}
      {km !== undefined && (
        <View style={styles.distanceRow}>
          <Icon name="map-marker-distance" size={16} color={colors.primary} />
          <Text style={styles.distanceText}>
            {formatKm(km)} from {from}
          </Text>
        </View>
      )}
      <View style={styles.cardActions}>
        <Pressable style={[styles.cardBtn, styles.cardBtnPrimary]} onPress={() => openLink(PAGES.clinics)}>
          <Icon name="calendar-check-outline" size={20} color="#fff" />
          <Text style={styles.cardBtnPrimaryText}>Book appointment</Text>
        </Pressable>
        <Pressable style={[styles.cardBtn, styles.cardBtnSecondary]} onPress={() => openLink(directionsUrl(clinic))}>
          <Icon name="directions" size={20} color={colors.primaryDark} />
          <Text style={styles.cardBtnSecondaryText}>Directions</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Bottom sheet to find a clinic: by the phone's location, or automatically as soon as a
 * 6-digit pincode is typed. onSelect({clinic, km, pincode?, district, state}) keeps the
 * Home banner in sync.
 */
export default function ClinicsSheet({visible, onSelect, onClose}) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef(null);

  const [gpsStatus, setGpsStatus] = useState('idle'); // idle | locating | found | error
  const [gpsError, setGpsError] = useState(null);
  const [here, setHere] = useState(null);

  const [pincode, setPincode] = useState('');
  const [searching, setSearching] = useState(false);
  const [pinError, setPinError] = useState(null);
  const [pinResult, setPinResult] = useState(null);

  const [selectedId, setSelectedId] = useState(null);

  const locate = useCallback(async () => {
    setGpsStatus('locating');
    setGpsError(null);
    try {
      setHere(await getCurrentLocation());
      setGpsStatus('found');
    } catch (e) {
      setGpsError(e.message);
      setGpsStatus('error');
    }
  }, []);

  useEffect(() => {
    if (visible && gpsStatus === 'idle') {
      locate();
    }
  }, [visible, gpsStatus, locate]);

  // A searched pincode wins over the phone's location
  const origin = pinResult?.point || (pinResult ? null : here);
  const clinics = useMemo(() => sortClinics(origin), [origin]);
  const originLabel = pinResult ? pinResult.pincode : 'your location';

  const selected = clinics.find(c => c.clinic.id === selectedId) ||
    (pinResult?.clinic && clinics.find(c => c.clinic.id === pinResult.clinic.id)) ||
    clinics[0];

  const search = async code => {
    Keyboard.dismiss();
    setSearching(true);
    setPinError(null);
    try {
      const found = await searchByPincode(code);
      setPinResult(found);
      setSelectedId(null);
      if (found.clinic) {
        onSelect({clinic: found.clinic, km: found.km, pincode: code, district: found.district, state: found.state});
      } else {
        setPinError(`No clinic near ${found.district} yet. Here are all our clinics.`);
      }
      scrollRef.current?.scrollTo({y: 0, animated: true});
    } catch (e) {
      setPinError(e.message);
    } finally {
      setSearching(false);
    }
  };

  const onChangePincode = value => {
    const code = value.replace(/[^0-9]/g, '');
    setPincode(code);
    setPinError(null);
    // Search by itself as soon as the 6th digit is typed
    if (code.length === 6 && code !== pinResult?.pincode) {
      search(code);
    }
  };

  const pick = ({clinic, km}) => {
    setSelectedId(clinic.id);
    onSelect({clinic, km, district: clinic.city, state: clinic.state});
    scrollRef.current?.scrollTo({y: 0, animated: true});
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, {paddingBottom: insets.bottom + spacing.sm}]}>
          <View style={styles.handle} />

          <View style={styles.titleRow}>
            <Text style={styles.title}>Clinics near you</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
              <Icon name="close" size={26} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView
            ref={scrollRef}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scroll}>
            {gpsStatus === 'locating' && (
              <View style={styles.statusRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.statusText, styles.statusInline]}>Finding clinics near you…</Text>
              </View>
            )}
            {gpsStatus === 'found' && !pinResult && (
              <View style={styles.statusRow}>
                <Icon name="crosshairs-gps" size={15} color={colors.primary} />
                <Text style={[styles.statusText, styles.statusInline]}>Sorted by distance from your location</Text>
              </View>
            )}
            {gpsStatus === 'error' && (
              <>
                <Text style={styles.statusText}>{gpsError}</Text>
                <Pressable onPress={locate} hitSlop={8} style={styles.retry}>
                  <Text style={styles.retryText}>Try again</Text>
                </Pressable>
              </>
            )}

            <View style={[styles.pinBox, !!pinError && !pinResult?.clinic && styles.pinBoxError]}>
              <Icon name="map-marker-outline" size={24} color={colors.primaryDark} />
              <TextInput
                style={styles.pinInput}
                placeholder="Enter pincode to find clinic"
                placeholderTextColor="#A3AAA5"
                keyboardType="number-pad"
                maxLength={6}
                returnKeyType="search"
                value={pincode}
                onChangeText={onChangePincode}
                onSubmitEditing={() => search(pincode)}
              />
              <Pressable
                style={[styles.findBtn, !isValidPincode(pincode) && styles.findBtnIdle]}
                onPress={() => search(pincode)}
                disabled={searching || !isValidPincode(pincode)}
                accessibilityLabel="Find clinic">
                {searching ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.findText}>Find</Text>
                )}
              </Pressable>
            </View>
            {!!pinError && <Text style={styles.pinError}>{pinError}</Text>}
            {!!pinResult && !pinResult.point && !!pinResult.clinic && (
              <Text style={styles.pinNote}>
                Matched by city for {pinResult.district}, {pinResult.state}
              </Text>
            )}

            {selected && <SelectedClinic clinic={selected.clinic} km={selected.km} from={originLabel} />}

            <Text style={styles.listTitle}>{origin ? 'Nearest clinics' : 'All clinics'}</Text>
            {clinics.map(item => {
              const {clinic, km} = item;
              const active = clinic.id === selected?.clinic.id;
              return (
                <Pressable
                  key={clinic.id}
                  style={[styles.row, active && styles.rowActive]}
                  onPress={() => pick(item)}
                  accessibilityRole="button">
                  <View style={[styles.pin, active && styles.pinActive]}>
                    <Icon name="map-marker-outline" size={26} color={active ? '#fff' : colors.primaryDark} />
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.name} numberOfLines={1}>
                      {clinic.name}
                    </Text>
                    <Text style={styles.area} numberOfLines={1}>
                      {clinic.area}
                      {km !== undefined && <Text style={styles.km}>{`  ·  ${formatKm(km)}`}</Text>}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)'},
  sheet: {
    maxHeight: '90%',
    backgroundColor: colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.md,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginTop: 10,
    marginBottom: spacing.sm,
  },
  titleRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4},
  title: {fontSize: 22, fontWeight: '800', color: colors.primaryDark},
  scroll: {paddingBottom: spacing.sm},
  statusRow: {flexDirection: 'row', alignItems: 'center', marginTop: 6},
  statusText: {fontSize: 13.5, lineHeight: 20, color: colors.muted, marginTop: 6},
  statusInline: {marginTop: 0, marginLeft: 8},
  retry: {alignSelf: 'flex-start', marginTop: 10},
  retryText: {fontSize: 14, fontWeight: '700', color: colors.primary},

  pinBox: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 58,
    marginTop: spacing.md,
    paddingLeft: 16,
    paddingRight: 6,
    borderRadius: 29,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  pinBoxError: {borderColor: colors.danger},
  pinInput: {flex: 1, marginHorizontal: 10, fontSize: 16, color: colors.text, paddingVertical: 0},
  findBtn: {
    height: 44,
    minWidth: 76,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  findBtnIdle: {backgroundColor: '#9CC3AA'},
  findText: {color: '#fff', fontWeight: '700', fontSize: 15},
  pinError: {fontSize: 12.5, color: colors.danger, marginTop: 6, marginLeft: 16},
  pinNote: {fontSize: 12.5, color: colors.muted, marginTop: 6, marginLeft: 16},

  card: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 20,
    backgroundColor: CREAM,
    borderWidth: 1,
    borderColor: CREAM_BORDER,
  },
  cardName: {fontSize: 18, fontWeight: '600', color: colors.text},
  cardArea: {fontSize: 14, color: colors.muted, marginTop: 2},
  cardAddress: {fontSize: 14, lineHeight: 21, color: colors.muted, marginTop: 10},
  distanceRow: {flexDirection: 'row', alignItems: 'center', marginTop: 10},
  distanceText: {fontSize: 13.5, fontWeight: '600', color: colors.primary, marginLeft: 6},
  cardActions: {flexDirection: 'row', marginTop: spacing.md},
  cardBtn: {
    height: 52,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  cardBtnPrimary: {flex: 1.4, backgroundColor: colors.primaryDark},
  cardBtnPrimaryText: {color: '#fff', fontWeight: '700', fontSize: 15, marginLeft: 8},
  cardBtnSecondary: {
    flex: 1,
    marginLeft: 10,
    borderWidth: 1.5,
    borderColor: colors.primaryDark,
    backgroundColor: colors.background,
  },
  cardBtnSecondaryText: {color: colors.primaryDark, fontWeight: '700', fontSize: 15, marginLeft: 6},

  listTitle: {fontSize: 17, fontWeight: '600', color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm},
  row: {flexDirection: 'row', alignItems: 'center', padding: 8, borderRadius: 18, marginBottom: 6},
  rowActive: {backgroundColor: colors.primaryLight},
  pin: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinActive: {backgroundColor: colors.primaryDark},
  rowText: {flex: 1, marginLeft: 14},
  name: {fontSize: 16, fontWeight: '600', color: colors.text},
  area: {fontSize: 13, color: colors.muted, marginTop: 2},
  km: {fontWeight: '700', color: colors.primary},
});
