import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  LayoutAnimation,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useIsFocused} from '@react-navigation/native';
import {CLINICS, CONTACT, PAGES} from '../data/store';
import ClinicsSheet from './ClinicsSheet';
import {colors} from '../theme';
import {searchByPincode} from '../utils/clinicSearch';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const CREAM = '#FFF9EC';
const CREAM_DEEP = '#FDF0D5';
const CREAM_BORDER = '#EFE2C4';
const INK = '#1F2A22';
const SOFT = '#6B746D';

const formatKm = km => (km < 10 ? `${km.toFixed(1)} km away` : `${Math.round(km)} km away`);

// The clinics sheet opens by itself only once per app launch
let sheetShownThisLaunch = false;

const openLink = url => Linking.openURL(url).catch(() => Alert.alert('Could not open', 'Please try again later.'));

const animate = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

function ClinicResult({result}) {
  if (!result.clinic) {
    return (
      <View style={styles.result}>
        <View style={styles.resultRow}>
          <View style={[styles.resultIcon, styles.resultIconMuted]}>
            <Icon name="map-marker-off-outline" size={22} color={SOFT} />
          </View>
          <View style={styles.resultText}>
            <Text style={styles.resultTitle}>No clinic in {result.district} yet</Text>
            <Text style={styles.resultMeta}>Our Unani experts can still help you online.</Text>
          </View>
        </View>
        <View style={styles.actions}>
          <Pressable style={[styles.actionBtn, styles.actionPrimary]} onPress={() => openLink(CONTACT.whatsappUrl)}>
            <Icon name="whatsapp" size={17} color="#fff" />
            <Text style={styles.actionPrimaryText}>Consult online</Text>
          </Pressable>
          <Pressable style={[styles.actionBtn, styles.actionSecondary]} onPress={() => openLink(PAGES.clinics)}>
            <Text style={styles.actionSecondaryText}>All clinics</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.result}>
      <View style={styles.resultRow}>
        <View style={styles.resultIcon}>
          <Icon name="hospital-building" size={22} color={colors.primaryDark} />
        </View>
        <View style={styles.resultText}>
          <View style={styles.resultTitleRow}>
            <Text style={styles.resultTitle} numberOfLines={1}>
              {result.clinic.name}
            </Text>
            <View style={styles.tag}>
              <Text style={styles.tagText}>NEAREST</Text>
            </View>
          </View>
          <View style={styles.metaRow}>
            <Icon name="map-marker-outline" size={13} color={SOFT} />
            <Text style={styles.resultMeta} numberOfLines={1}>
              {result.km !== undefined
                ? `${formatKm(result.km)}${result.pincode ? ` from ${result.pincode}` : ''} · ${result.clinic.area}`
                : result.pincode
                ? `Near ${result.district}, ${result.state}`
                : result.clinic.area}
            </Text>
          </View>
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable style={[styles.actionBtn, styles.actionPrimary]} onPress={() => openLink(PAGES.clinics)}>
          <Icon name="calendar-check-outline" size={17} color="#fff" />
          <Text style={styles.actionPrimaryText}>Book appointment</Text>
        </Pressable>
        <Pressable
          style={[styles.actionBtn, styles.actionSecondary]}
          onPress={() => openLink(CONTACT.phoneUrl)}
          accessibilityLabel="Call us">
          <Icon name="phone-outline" size={17} color={colors.primaryDark} />
          <Text style={styles.actionSecondaryText}>Call</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Floating "Find your nearest clinic" card that expands to a pincode search. */
export default function ClinicLocator({style}) {
  const [open, setOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pincode, setPincode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null); // {pincode?, district, state, clinic, km?}

  // Home can stay mounted under other screens (e.g. Login), so only auto-open while it is on screen
  const focused = useIsFocused();
  useEffect(() => {
    if (focused && !sheetShownThisLaunch) {
      sheetShownThisLaunch = true;
      setSheetOpen(true);
    }
  }, [focused]);

  const toggle = () => {
    animate();
    if (open) {
      Keyboard.dismiss();
    }
    setOpen(o => !o);
  };

  const onSearch = async (code = pincode) => {
    Keyboard.dismiss();
    setLoading(true);
    setError(null);
    try {
      const found = await searchByPincode(code);
      animate();
      setResult(found);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const onChangePincode = value => {
    const code = value.replace(/[^0-9]/g, '');
    setPincode(code);
    setError(null);
    // Search by itself as soon as the 6th digit is typed
    if (code.length === 6 && code !== result?.pincode) {
      onSearch(code);
    }
  };

  // Keeps the banner in sync with whatever is picked in the sheet
  const onSelectClinic = picked => {
    animate();
    setError(null);
    setOpen(true);
    setResult(picked);
    if (picked.pincode) {
      setPincode(picked.pincode);
    }
  };

  let subtitle = 'Tap to enter your pincode';
  if (result) {
    const where = result.pincode || result.clinic?.area;
    subtitle = `${where} · ${result.clinic ? result.clinic.name : 'No clinic nearby yet'}`;
  }

  return (
    <View style={[styles.card, style]}>
      <Pressable
        style={styles.header}
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        accessibilityLabel="Find your nearest clinic">
        <View style={styles.iconRing}>
          <View style={styles.iconCircle}>
            <Icon name="map-marker" size={22} color="#fff" />
          </View>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>CLINIC LOCATION</Text>
          <Text style={styles.title} numberOfLines={1}>
            Find your nearest clinic
          </Text>
          <Text style={[styles.subtitle, result?.clinic && styles.subtitleFound]} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <View style={styles.chevron}>
          <Icon name={open ? 'chevron-down' : 'chevron-up'} size={22} color={colors.primaryDark} />
        </View>
      </Pressable>

      {open && (
        <View style={styles.body}>
          <View style={styles.divider} />

          <Text style={styles.label}>Check clinic availability</Text>
          <View style={styles.inputRow}>
            <View style={[styles.inputWrap, !!error && styles.inputError]}>
              <Icon name="crosshairs-gps" size={18} color={colors.primary} />
              <TextInput
                style={styles.input}
                placeholder="6-digit pincode"
                placeholderTextColor="#A3AAA5"
                keyboardType="number-pad"
                maxLength={6}
                returnKeyType="search"
                value={pincode}
                onChangeText={onChangePincode}
                onSubmitEditing={() => onSearch()}
              />
              {pincode.length > 0 && (
                <Pressable onPress={() => setPincode('')} hitSlop={8} accessibilityLabel="Clear pincode">
                  <Icon name="close-circle" size={18} color="#C2C8C4" />
                </Pressable>
              )}
            </View>
            <Pressable
              style={[styles.findBtn, pincode.length < 6 && styles.findBtnIdle]}
              onPress={() => onSearch()}
              disabled={loading}
              accessibilityLabel="Find clinic">
              {loading ? <ActivityIndicator color="#fff" size="small" /> : <Icon name="arrow-right" size={22} color="#fff" />}
            </Pressable>
          </View>
          {!!error && (
            <View style={styles.errorRow}>
              <Icon name="alert-circle-outline" size={14} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {result && <ClinicResult result={result} />}

          <Pressable style={styles.allBtn} onPress={() => setSheetOpen(true)}>
            <Icon name="crosshairs-gps" size={16} color={colors.primary} />
            <Text style={styles.allBtnText}>Use my location · View all {CLINICS.length} clinics</Text>
            <Icon name="chevron-right" size={18} color={colors.primary} />
          </Pressable>
        </View>
      )}

      <ClinicsSheet
        visible={sheetOpen && focused}
        onSelect={onSelectClinic}
        onClose={() => setSheetOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: CREAM,
    backgroundImage: `linear-gradient(180deg, ${CREAM} 0%, ${CREAM_DEEP} 100%)`,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: CREAM_BORDER,
    elevation: 10,
    shadowColor: '#3B2F12',
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: {width: 0, height: 6},
  },
  header: {flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingLeft: 12, paddingRight: 14},
  iconRing: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(20,83,45,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {flex: 1, marginHorizontal: 12},
  eyebrow: {fontSize: 10.5, fontWeight: '700', letterSpacing: 1.1, color: colors.primary},
  title: {fontSize: 16.5, fontWeight: '700', color: INK, marginTop: 2},
  subtitle: {fontSize: 12.5, color: SOFT, marginTop: 2},
  subtitleFound: {color: colors.primary, fontWeight: '600'},
  chevron: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CREAM_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {paddingHorizontal: 14, paddingBottom: 14},
  divider: {height: 1, backgroundColor: CREAM_BORDER, marginBottom: 12},
  label: {fontSize: 12, fontWeight: '700', color: SOFT, marginBottom: 8},
  inputRow: {flexDirection: 'row', alignItems: 'center'},
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CREAM_BORDER,
    backgroundColor: '#fff',
    paddingHorizontal: 14,
  },
  inputError: {borderColor: colors.danger},
  input: {
    flex: 1,
    marginHorizontal: 10,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 2,
    color: INK,
    paddingVertical: 0,
  },
  findBtn: {
    width: 48,
    height: 48,
    marginLeft: 8,
    borderRadius: 14,
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  findBtnIdle: {opacity: 0.55},
  errorRow: {flexDirection: 'row', alignItems: 'center', marginTop: 6},
  errorText: {fontSize: 12, color: colors.danger, marginLeft: 4, flex: 1},
  allBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingHorizontal: 12,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CREAM_BORDER,
  },
  allBtnText: {flex: 1, fontSize: 13.5, fontWeight: '700', color: colors.primary, marginLeft: 8},
  result: {
    marginTop: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CREAM_BORDER,
  },
  resultRow: {flexDirection: 'row', alignItems: 'center'},
  resultIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultIconMuted: {backgroundColor: '#F1F3F1'},
  resultText: {flex: 1, marginLeft: 12},
  resultTitleRow: {flexDirection: 'row', alignItems: 'center'},
  resultTitle: {fontSize: 15, fontWeight: '700', color: INK, flexShrink: 1},
  tag: {marginLeft: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.primaryLight},
  tagText: {fontSize: 9.5, fontWeight: '800', letterSpacing: 0.6, color: colors.primary},
  metaRow: {flexDirection: 'row', alignItems: 'center', marginTop: 3},
  resultMeta: {fontSize: 12.5, color: SOFT, marginLeft: 3, flexShrink: 1},
  actions: {flexDirection: 'row', marginTop: 12},
  actionBtn: {
    height: 40,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  actionPrimary: {flex: 1, backgroundColor: colors.primaryDark},
  actionPrimaryText: {color: '#fff', fontWeight: '700', fontSize: 13.5, marginLeft: 6},
  actionSecondary: {marginLeft: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.primaryDark},
  actionSecondaryText: {color: colors.primaryDark, fontWeight: '700', fontSize: 13.5, marginLeft: 4},
});
