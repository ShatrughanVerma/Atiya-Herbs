import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  createAddress,
  deleteAddress,
  listAddresses,
  makeDefaultAddress,
  updateAddress,
} from '../../services/shopApi';
import {colors} from '../../theme';

// The delivery addresses of the logged-in person, kept on the server: choose one, add, change, remove, make default.
// `onSelect(address | null)` tells the screen which one is chosen.

const FIELDS = [
  {key: 'name', label: 'Full name', autoCapitalize: 'words'},
  {key: 'phone', label: 'Mobile number', keyboardType: 'phone-pad', maxLength: 10},
  {key: 'pincode', label: 'Pincode', keyboardType: 'number-pad', maxLength: 6, half: true},
  {key: 'city', label: 'City', autoCapitalize: 'words', half: true},
  {key: 'line1', label: 'House no., building, street', autoCapitalize: 'sentences'},
  {key: 'line2', label: 'Area, landmark (optional)', autoCapitalize: 'sentences'},
  {key: 'state', label: 'State', autoCapitalize: 'words'},
];

const EMPTY = {name: '', phone: '', pincode: '', city: '', line1: '', line2: '', state: ''};

// The same rules the server has, so most mistakes are caught before anything is sent
export const validateAddress = a => {
  const errors = {};
  if (a.name.trim().length < 2) {
    errors.name = 'Enter your full name';
  }
  if (!/^[6-9][0-9]{9}$/.test(a.phone)) {
    errors.phone = 'Enter a valid 10-digit mobile number';
  }
  if (!/^[1-9][0-9]{5}$/.test(a.pincode)) {
    errors.pincode = 'Enter a valid pincode';
  }
  if (!a.city.trim()) {
    errors.city = 'Enter your city';
  }
  if (a.line1.trim().length < 5) {
    errors.line1 = 'Enter your full address';
  }
  if (!a.state.trim()) {
    errors.state = 'Enter your state';
  }
  return errors;
};

function AddressForm({initial, saving, serverErrors, onSave, onCancel}) {
  const [address, setAddress] = useState(initial);
  const [errors, setErrors] = useState({});

  const update = (key, value) => {
    setAddress(a => ({...a, [key]: key === 'phone' || key === 'pincode' ? value.replace(/[^0-9]/g, '') : value}));
    setErrors(e => ({...e, [key]: undefined}));
  };

  const submit = () => {
    const found = validateAddress(address);
    setErrors(found);
    if (Object.keys(found).length === 0) {
      onSave(address);
    }
  };
  const shown = {...serverErrors, ...errors};

  return (
    <View>
      <View style={styles.fieldWrap}>
        {FIELDS.map(f => (
          <View key={f.key} style={f.half ? styles.half : styles.full}>
            <Text style={styles.label}>{f.label}</Text>
            <TextInput
              style={[styles.input, shown[f.key] && styles.inputError]}
              value={address[f.key]}
              onChangeText={v => update(f.key, v)}
              keyboardType={f.keyboardType}
              autoCapitalize={f.autoCapitalize}
              maxLength={f.maxLength}
              placeholderTextColor={colors.muted}
              accessibilityLabel={f.label}
            />
            {!!shown[f.key] && <Text style={styles.error}>{shown[f.key]}</Text>}
          </View>
        ))}
      </View>
      <View style={styles.formButtons}>
        {!!onCancel && (
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={onCancel} disabled={saving}>
            <Text style={styles.btnGhostText}>Cancel</Text>
          </Pressable>
        )}
        <Pressable
          style={[styles.btn, saving && styles.btnOff]}
          onPress={submit}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="Save address">
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save address</Text>}
        </Pressable>
      </View>
    </View>
  );
}

export default function AddressPicker({selectedId, onSelect}) {
  const [state, setState] = useState({status: 'loading', list: [], message: ''});
  const [form, setForm] = useState(null); // null | {id: string | null, initial}
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState({});

  const load = useCallback(async (keepSelection = false) => {
    try {
      const list = await listAddresses();
      setState({status: 'ready', list, message: ''});
      if (list.length === 0) {
        onSelect(null);
        setForm({id: null, initial: EMPTY});
      } else if (!keepSelection) {
        onSelect(list.find(a => a.isDefault) ?? list[0]);
      }
      return list;
    } catch (error) {
      setState({status: 'error', list: [], message: error.message});
      return null;
    }
  }, [onSelect]);

  useEffect(() => {
    load();
    // only once: later changes reload by hand
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async address => {
    setSaving(true);
    setServerErrors({});
    const body = {...address, line2: address.line2.trim() ? address.line2.trim() : null};
    try {
      const saved = form.id ? await updateAddress(form.id, body) : await createAddress(body);
      setForm(null);
      const list = await load(true);
      if (list) {
        onSelect(list.find(a => a.id === saved.id) ?? saved);
      }
    } catch (error) {
      setServerErrors(error.fields || {});
      if (!Object.keys(error.fields || {}).length) {
        Alert.alert('Address', error.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = address =>
    Alert.alert('Remove address', `Remove the address for ${address.name}?`, [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteAddress(address.id);
            const list = await load(true);
            if (list && selectedId === address.id) {
              onSelect(list.find(a => a.isDefault) ?? list[0] ?? null);
            }
          } catch (error) {
            Alert.alert('Address', error.message);
          }
        },
      },
    ]);

  const makeDefault = async address => {
    try {
      await makeDefaultAddress(address.id);
      await load(true);
    } catch (error) {
      Alert.alert('Address', error.message);
    }
  };

  if (state.status === 'loading') {
    return <ActivityIndicator color={colors.primary} style={styles.loading} />;
  }
  if (state.status === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{state.message}</Text>
        <Pressable style={styles.btn} onPress={() => load()} accessibilityRole="button" accessibilityLabel="Retry">
          <Text style={styles.btnText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (form) {
    return (
      <AddressForm
        initial={form.initial}
        saving={saving}
        serverErrors={serverErrors}
        onSave={save}
        onCancel={state.list.length > 0 ? () => setForm(null) : undefined}
      />
    );
  }

  return (
    <View>
      {state.list.map(a => {
        const selected = a.id === selectedId;
        return (
          <View key={a.id} style={[styles.card, selected && styles.cardSelected]}>
            <Pressable
              style={styles.cardMain}
              onPress={() => onSelect(a)}
              accessibilityRole="radio"
              accessibilityState={{selected}}
              accessibilityLabel={`Deliver to ${a.name}`}>
              <Icon name={selected ? 'radiobox-marked' : 'radiobox-blank'} size={22} color={selected ? colors.primary : colors.muted} />
              <View style={styles.cardText}>
                <Text style={styles.name}>
                  {a.name} · {a.phone}
                  {a.isDefault ? '  (Default)' : ''}
                </Text>
                <Text style={styles.line}>
                  {a.line1}
                  {a.line2 ? `, ${a.line2}` : ''}, {a.city}, {a.state} {a.pincode}
                </Text>
              </View>
            </Pressable>
            <View style={styles.cardActions}>
              <Pressable
                onPress={() =>
                  setForm({
                    id: a.id,
                    initial: {name: a.name, phone: a.phone, pincode: a.pincode, city: a.city, state: a.state, line1: a.line1, line2: a.line2 ?? ''},
                  })
                }
                hitSlop={6}>
                <Text style={styles.action}>Edit</Text>
              </Pressable>
              <Pressable onPress={() => remove(a)} hitSlop={6}>
                <Text style={[styles.action, styles.actionDanger]}>Remove</Text>
              </Pressable>
              {!a.isDefault && (
                <Pressable onPress={() => makeDefault(a)} hitSlop={6}>
                  <Text style={styles.action}>Make default</Text>
                </Pressable>
              )}
            </View>
          </View>
        );
      })}
      <Pressable
        style={styles.addBtn}
        onPress={() => {
          setServerErrors({});
          setForm({id: null, initial: EMPTY});
        }}
        accessibilityRole="button"
        accessibilityLabel="Add new address">
        <Icon name="plus" size={18} color={colors.primary} />
        <Text style={styles.addText}>Add new address</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {marginVertical: 20},
  center: {alignItems: 'center', paddingVertical: 12},
  fieldWrap: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between'},
  full: {width: '100%', marginBottom: 10},
  half: {width: '48%', marginBottom: 10},
  label: {fontSize: 12, color: colors.muted, marginBottom: 4, fontWeight: '600'},
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 46,
    color: colors.text,
    fontSize: 15,
  },
  inputError: {borderColor: colors.danger},
  error: {color: colors.danger, fontSize: 12, marginTop: 4},
  formButtons: {flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4},
  btn: {backgroundColor: colors.accent, paddingHorizontal: 22, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginLeft: 8},
  btnOff: {opacity: 0.6},
  btnText: {color: '#fff', fontWeight: '800'},
  btnGhost: {backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border},
  btnGhostText: {color: colors.text, fontWeight: '700'},
  card: {borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, marginBottom: 8},
  cardSelected: {borderColor: colors.primary, backgroundColor: colors.primaryLight},
  cardMain: {flexDirection: 'row', alignItems: 'flex-start'},
  cardText: {flex: 1, marginLeft: 10},
  name: {fontWeight: '700', color: colors.text},
  line: {color: colors.muted, marginTop: 2, lineHeight: 18},
  cardActions: {flexDirection: 'row', marginTop: 8, marginLeft: 32},
  action: {color: colors.primary, fontWeight: '700', fontSize: 13, marginRight: 18},
  actionDanger: {color: colors.danger},
  addBtn: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10},
  addText: {color: colors.primary, fontWeight: '800', marginLeft: 6},
});
