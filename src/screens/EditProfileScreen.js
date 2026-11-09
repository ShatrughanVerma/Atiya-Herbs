import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ScreenHeader from '../components/shop/ScreenHeader';
import { isServerAccount, useAuth } from '../context/AuthContext';
import { passwordProblem, PASSWORD_HINT } from '../utils/passwordRules';
import { colors, spacing } from '../theme';
import { chooseProfilePhoto } from '../utils/profilePhoto';
import { formatMobile } from '../calling/phone';
import useKeyboardHeight from '../utils/useKeyboardHeight';

const GENDERS = ['Male', 'Female', 'Other'];

// Quick checks on the phone; the server checks again and its messages are shown under the same boxes
const validate = ({ name, email }) => {
  const errors = {};
  if (name.trim().length < 2) {
    errors.name = 'Please enter your full name';
  }
  if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    errors.email = 'Please enter a valid email';
  }
  return errors;
};

function Field({ label, error, children }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.field, error && styles.fieldError]}>{children}</View>
      {!!error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

// "Change password": the current one and a new one. The server ends the logins on other phones.
function ChangePassword({ changePassword }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ current: '', next: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const update = (key, value) => {
    setForm(f => ({ ...f, [key]: value }));
    setErrors(e => ({ ...e, [key]: undefined, form: undefined }));
  };

  const submit = async () => {
    const found = {};
    if (!form.current) {
      found.current = 'Enter your current password.';
    }
    const weak = passwordProblem(form.next);
    if (weak) {
      found.next = weak;
    }
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }
    setBusy(true);
    try {
      await changePassword(form.current, form.next);
      setForm({ current: '', next: '' });
      setOpen(false);
      Alert.alert(
        'Password changed',
        'Your password was changed. Other phones need to log in again.',
      );
    } catch (e) {
      const fields = e.fields || {};
      if (fields.currentPassword || fields.newPassword) {
        setErrors({
          current: fields.currentPassword,
          next: fields.newPassword,
        });
      } else {
        setErrors({ form: e.message });
      }
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Pressable
        style={styles.linkRow}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Change password"
      >
        <Icon name="lock-reset" size={20} color={colors.primary} />
        <Text style={styles.linkRowText}>Change password</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.passwordBox}>
      <Text style={styles.label}>Change password</Text>
      <Field label="Current password" error={errors.current}>
        <TextInput
          style={styles.input}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="password"
          maxLength={128}
          placeholder="Current password"
          placeholderTextColor={colors.muted}
          value={form.current}
          onChangeText={v => update('current', v)}
          accessibilityLabel="Current password"
        />
      </Field>
      <Field label="New password" error={errors.next}>
        <TextInput
          style={styles.input}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          maxLength={128}
          placeholder="New password"
          placeholderTextColor={colors.muted}
          value={form.next}
          onChangeText={v => update('next', v)}
          accessibilityLabel="New password"
        />
      </Field>
      {!errors.next && <Text style={styles.hint2}>{PASSWORD_HINT}</Text>}
      {!!errors.form && (
        <Text style={styles.errorText} accessibilityRole="alert">
          {errors.form}
        </Text>
      )}
      <View style={styles.passwordButtons}>
        <Pressable
          style={[styles.smallBtn, styles.smallBtnGhost]}
          onPress={() => {
            setOpen(false);
            setErrors({});
            setForm({ current: '', next: '' });
          }}
          accessibilityRole="button"
          accessibilityLabel="Cancel changing password"
        >
          <Text style={styles.smallBtnGhostText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={styles.smallBtn}
          onPress={submit}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Update password"
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.smallBtnText}>Update password</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

export default function EditProfileScreen({ navigation }) {
  const { width } = useWindowDimensions();
  const keyboard = useKeyboardHeight();
  const avatarSize = Math.round(Math.min(120, Math.max(76, width * 0.26))); // smaller on small phones
  const { user, signIn, updateProfile, changePassword } = useAuth();
  const isGoogle = user?.provider === 'google';
  // A server account lives in the database: its mobile number is the account itself, name and email are saved there
  const isServer = isServerAccount(user);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    mobile: user?.mobile || '',
    gender: user?.gender || null,
    photo: user?.photo || null,
  });
  const [errors, setErrors] = useState({});

  const update = (key, value) => {
    setForm(f => ({
      ...f,
      [key]: key === 'mobile' ? value.replace(/[^0-9]/g, '') : value,
    }));
    setErrors(e => ({ ...e, [key]: undefined }));
  };

  const onSave = async () => {
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }
    let saved = { name: form.name.trim(), email: form.email.trim() };
    if (isServer) {
      // Only what changed goes to the server (it accepts name and email only)
      const changes = {};
      if (saved.name !== (user.name || '')) {
        changes.name = saved.name;
      }
      if (saved.email && saved.email !== (user.email || '')) {
        changes.email = saved.email;
      }
      if (Object.keys(changes).length > 0) {
        setSaving(true);
        try {
          const me = await updateProfile(changes);
          saved = { name: me.name || saved.name, email: me.email || '' };
        } catch (e) {
          const fields = e.fields || {};
          if (fields.name || fields.email) {
            setErrors({ name: fields.name, email: fields.email });
          } else if (e.kind === 'conflict') {
            setErrors({ email: e.message }); // the email belongs to another account
          } else {
            Alert.alert('Profile', e.message || 'Could not save your changes.');
          }
          return;
        } finally {
          setSaving(false);
        }
      } else {
        saved = { name: user.name || saved.name, email: user.email || '' };
      }
    }
    // Photo and gender stay on this phone
    signIn({
      ...user,
      ...saved,
      mobile: isServer ? user.mobile : form.mobile,
      gender: form.gender,
      photo: form.photo,
    });
    Alert.alert('Profile updated', 'Your changes have been saved.');
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader title="Edit Profile" navigation={navigation} />
      <View style={styles.flex}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: 40 + keyboard },
          ]}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <Pressable
            style={styles.avatarWrap}
            onPress={() =>
              chooseProfilePhoto(!!form.photo, photo => update('photo', photo))
            }
            accessibilityLabel="Change profile photo"
          >
            <View
              style={[
                styles.avatar,
                {
                  width: avatarSize,
                  height: avatarSize,
                  borderRadius: avatarSize / 2,
                },
              ]}
            >
              {form.photo ? (
                <Image
                  source={{ uri: form.photo }}
                  style={styles.avatarPhoto}
                />
              ) : (
                <Icon
                  name="account"
                  size={avatarSize * 0.52}
                  color={colors.primary}
                />
              )}
            </View>
            <View style={styles.cameraBadge}>
              <Icon name="camera" size={16} color="#fff" />
            </View>
          </Pressable>
          <Text style={styles.changePhoto}>Change photo</Text>

          <View style={styles.form}>
            <Field label="Full name" error={errors.name}>
              <TextInput
                style={styles.input}
                placeholder="Full name"
                placeholderTextColor={colors.muted}
                autoCapitalize="words"
                autoComplete="name"
                value={form.name}
                onChangeText={v => update('name', v)}
              />
            </Field>

            <Field label="Email" error={errors.email}>
              <TextInput
                style={[styles.input, isGoogle && styles.inputLocked]}
                placeholder="Email"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                editable={!isGoogle}
                value={form.email}
                onChangeText={v => update('email', v)}
              />
              {isGoogle && (
                <Icon name="lock-outline" size={18} color={colors.muted} />
              )}
            </Field>
            {isGoogle && (
              <Text style={styles.hint}>
                Email is linked to your Google account
              </Text>
            )}

            <Field label="Mobile number" error={errors.mobile}>
              <Text style={styles.code}>+91</Text>
              <View style={styles.codeDivider} />
              <TextInput
                style={[styles.input, isServer && styles.inputLocked]}
                editable={!isServer}
                placeholder="Mobile number"
                placeholderTextColor={colors.muted}
                keyboardType="phone-pad"
                autoComplete="tel"
                maxLength={10}
                value={form.mobile}
                onChangeText={v => update('mobile', v)}
                accessibilityLabel={
                  isServer
                    ? `Mobile number ${formatMobile(
                        form.mobile,
                      )}, cannot be changed`
                    : 'Mobile number'
                }
              />
              {isServer && (
                <Icon name="lock-outline" size={18} color={colors.muted} />
              )}
            </Field>
            {isServer && (
              <Text style={styles.hint}>
                Your mobile number is your account, so it cannot be changed here
              </Text>
            )}

            <Text style={styles.label}>Gender</Text>
            <View style={styles.genderRow}>
              {GENDERS.map(g => {
                const active = form.gender === g;
                return (
                  <Pressable
                    key={g}
                    style={[
                      styles.genderChip,
                      active && styles.genderChipActive,
                    ]}
                    onPress={() => update('gender', active ? null : g)}
                  >
                    <Text
                      style={[
                        styles.genderText,
                        active && styles.genderTextActive,
                      ]}
                    >
                      {g}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              style={styles.saveBtn}
              onPress={onSave}
              disabled={saving}
              accessibilityRole="button"
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveText}>Save changes</Text>
              )}
            </Pressable>

            {isServer && <ChangePassword changePassword={changePassword} />}
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: 40, alignItems: 'center' },
  form: { width: '100%', maxWidth: 520 }, // fills a phone, stays readable on a tablet
  avatarWrap: { alignSelf: 'center', marginTop: spacing.sm },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarPhoto: { width: '100%', height: '100%' },
  cameraBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accent,
    borderWidth: 3,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  changePhoto: {
    alignSelf: 'center',
    color: colors.primary,
    fontWeight: '700',
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  fieldWrap: { marginBottom: spacing.md },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 6,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
  },
  fieldError: { borderColor: colors.danger },
  input: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 0 },
  inputLocked: { color: colors.muted },
  errorText: { fontSize: 12, color: colors.danger, marginTop: 4 },
  hint: {
    fontSize: 12,
    color: colors.muted,
    marginTop: -10,
    marginBottom: spacing.md,
  },
  code: { fontSize: 15, color: colors.text },
  codeDivider: {
    width: 1,
    height: 22,
    backgroundColor: colors.border,
    marginHorizontal: 12,
  },
  genderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  genderChip: {
    flexGrow: 1,
    flexBasis: 90,
    minHeight: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  genderChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  genderText: { fontWeight: '600', color: colors.text },
  genderTextActive: { color: '#fff' },
  saveBtn: {
    minHeight: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 48,
    marginTop: spacing.md,
  },
  linkRowText: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  passwordBox: {
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  hint2: {
    fontSize: 12,
    color: colors.muted,
    marginTop: -8,
    marginBottom: spacing.md,
  },
  passwordButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  smallBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 23,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  smallBtnGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  smallBtnGhostText: { color: colors.text, fontSize: 15, fontWeight: '600' },
});
