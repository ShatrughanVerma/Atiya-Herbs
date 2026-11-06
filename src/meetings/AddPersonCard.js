import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  isContactPickerAvailable,
  pickContactNumber,
} from '../calling/contactPicker';
import { formatMobile, normalizeMobile } from '../calling/phone';
import { ADD_PERSON_ERRORS } from '../calling/addPersonErrors';

// A card over the call or meeting screen to add someone by mobile number (typed, or picked from the phone's
// contacts). It is a Modal of its own, so it is always drawn above the call screen.
// `onAdd(number)` resolves to {ok} or {ok: false, error}; on success the card closes itself.

export default function AddPersonCard({
  title,
  note,
  onAdd,
  onClose,
  errors = ADD_PERSON_ERRORS, // what to say for each reason the server may give
}) {
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState(null); // name of the contact just picked, to show it landed in the box

  const submit = async () => {
    const mobile = normalizeMobile(number);
    if (!mobile) {
      setError(errors['invalid-number'] || ADD_PERSON_ERRORS['invalid-number']);
      return;
    }
    setError('');
    setBusy(true);
    const res = await onAdd(mobile);
    setBusy(false);
    if (res?.ok) {
      onClose();
    } else {
      setError(errors[res?.error] || ADD_PERSON_ERRORS.failed);
    }
  };

  const pick = async () => {
    try {
      const contact = await pickContactNumber();
      if (!contact) {
        return;
      }
      const mobile = normalizeMobile(contact.number);
      if (!mobile) {
        setError(`${contact.number} is not an Indian mobile number.`);
        return;
      }
      setError('');
      setNumber(mobile);
      setPicked(contact.name || '');
    } catch (e) {
      setError('Could not open your contacts.');
    }
  };

  // Its own Modal, so it is drawn above the call's video and controls whatever they are doing
  return (
    <Modal
      transparent
      visible
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.center}
        >
          <View style={styles.card} accessibilityViewIsModal>
            <Text style={styles.title}>{title}</Text>
            {!!note && <Text style={styles.note}>{note}</Text>}
            <View style={styles.inputRow}>
              <Text style={styles.prefix}>+91</Text>
              <TextInput
                style={styles.input}
                value={number}
                onChangeText={text => {
                  setNumber(text);
                  setPicked(null);
                  setError('');
                }}
                placeholder="Mobile number"
                placeholderTextColor="rgba(255,255,255,0.5)"
                keyboardType="phone-pad"
                maxLength={16}
                autoFocus
                onSubmitEditing={submit}
                accessibilityLabel="Mobile number to add"
              />
              {isContactPickerAvailable && (
                <Pressable
                  onPress={pick}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Pick from contacts"
                >
                  <Icon name="account-box-outline" size={28} color="#fff" />
                </Pressable>
              )}
            </View>
            {!!normalizeMobile(number) && (
              <Text style={styles.preview}>
                {picked !== null
                  ? `Selected${picked ? ` ${picked}` : ''}: ${formatMobile(
                      number,
                    )}`
                  : formatMobile(number)}
              </Text>
            )}
            {!!error && (
              <Text style={styles.error} accessibilityRole="alert">
                {error}
              </Text>
            )}
            <View style={styles.buttons}>
              <Pressable
                style={[styles.btn, styles.cancel]}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Cancel adding"
              >
                <Text style={styles.btnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.btn, styles.add, busy && styles.busy]}
                onPress={submit}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Add this number"
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.btnText}>Add</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  // Near the top, not the middle: the keyboard opens at once and would cover a centred card
  center: {
    flex: 1,
    justifyContent: 'flex-start',
    paddingTop: 72,
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: '#1F2C34',
    borderRadius: 20,
    padding: 20,
    maxWidth: 460,
    width: '100%',
    alignSelf: 'center',
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  note: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 4 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 50,
  },
  prefix: { color: 'rgba(255,255,255,0.8)', fontSize: 16 },
  input: { flex: 1, color: '#fff', fontSize: 17, paddingVertical: 0 },
  preview: { color: '#25D366', fontSize: 13, marginTop: 6 },
  error: { color: '#F15C6D', fontSize: 13, marginTop: 8 },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 18 },
  btn: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancel: { backgroundColor: 'rgba(255,255,255,0.15)' },
  add: { backgroundColor: '#25D366' },
  busy: { opacity: 0.7 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
