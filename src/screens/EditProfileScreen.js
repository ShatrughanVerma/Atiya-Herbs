import React, {useState} from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ScreenHeader from '../components/shop/ScreenHeader';
import {useAuth} from '../context/AuthContext';
import {colors, spacing} from '../theme';
import {chooseProfilePhoto} from '../utils/profilePhoto';

const GENDERS = ['Male', 'Female', 'Other'];

const validate = ({name, email, mobile}) => {
  const errors = {};
  if (name.trim().length < 2) {
    errors.name = 'Please enter your full name';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    errors.email = 'Please enter a valid email';
  }
  if (mobile && !/^[6-9][0-9]{9}$/.test(mobile)) {
    errors.mobile = 'Please enter a valid 10-digit mobile number';
  }
  return errors;
};

function Field({label, error, children}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.field, error && styles.fieldError]}>{children}</View>
      {!!error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

export default function EditProfileScreen({navigation}) {
  const {user, signIn} = useAuth();
  const isGoogle = user?.provider === 'google';
  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    mobile: user?.mobile || '',
    gender: user?.gender || null,
    photo: user?.photo || null,
  });
  const [errors, setErrors] = useState({});

  const update = (key, value) => {
    setForm(f => ({...f, [key]: key === 'mobile' ? value.replace(/[^0-9]/g, '') : value}));
    setErrors(e => ({...e, [key]: undefined}));
  };

  const onSave = () => {
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }
    // TODO: save the changes to the customer account on the backend
    signIn({
      ...user,
      name: form.name.trim(),
      email: form.email.trim(),
      mobile: form.mobile,
      gender: form.gender,
      photo: form.photo,
    });
    Alert.alert('Profile updated', 'Your changes have been saved.');
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader title="Edit Profile" navigation={navigation} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable
            style={styles.avatarWrap}
            onPress={() => chooseProfilePhoto(!!form.photo, photo => update('photo', photo))}
            accessibilityLabel="Change profile photo">
            <View style={styles.avatar}>
              {form.photo ? (
                <Image source={{uri: form.photo}} style={styles.avatarPhoto} />
              ) : (
                <Icon name="account" size={52} color={colors.primary} />
              )}
            </View>
            <View style={styles.cameraBadge}>
              <Icon name="camera" size={16} color="#fff" />
            </View>
          </Pressable>
          <Text style={styles.changePhoto}>Change photo</Text>

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
            {isGoogle && <Icon name="lock-outline" size={18} color={colors.muted} />}
          </Field>
          {isGoogle && <Text style={styles.hint}>Email is linked to your Google account</Text>}

          <Field label="Mobile number" error={errors.mobile}>
            <Text style={styles.code}>+91</Text>
            <View style={styles.codeDivider} />
            <TextInput
              style={styles.input}
              placeholder="Mobile number"
              placeholderTextColor={colors.muted}
              keyboardType="phone-pad"
              autoComplete="tel"
              maxLength={10}
              value={form.mobile}
              onChangeText={v => update('mobile', v)}
            />
          </Field>

          <Text style={styles.label}>Gender</Text>
          <View style={styles.genderRow}>
            {GENDERS.map(g => {
              const active = form.gender === g;
              return (
                <Pressable
                  key={g}
                  style={[styles.genderChip, active && styles.genderChipActive]}
                  onPress={() => update('gender', active ? null : g)}>
                  <Text style={[styles.genderText, active && styles.genderTextActive]}>{g}</Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable style={styles.saveBtn} onPress={onSave} accessibilityRole="button">
            <Text style={styles.saveText}>Save changes</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background},
  flex: {flex: 1},
  content: {padding: spacing.md, paddingBottom: 40},
  avatarWrap: {alignSelf: 'center', marginTop: spacing.sm},
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarPhoto: {width: '100%', height: '100%'},
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
  fieldWrap: {marginBottom: spacing.md},
  label: {fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 6},
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
  },
  fieldError: {borderColor: colors.danger},
  input: {flex: 1, fontSize: 15, color: colors.text, paddingVertical: 0},
  inputLocked: {color: colors.muted},
  errorText: {fontSize: 12, color: colors.danger, marginTop: 4},
  hint: {fontSize: 12, color: colors.muted, marginTop: -10, marginBottom: spacing.md},
  code: {fontSize: 15, color: colors.text},
  codeDivider: {width: 1, height: 22, backgroundColor: colors.border, marginHorizontal: 12},
  genderRow: {flexDirection: 'row', marginBottom: spacing.lg},
  genderChip: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  genderChipActive: {backgroundColor: colors.primary, borderColor: colors.primary},
  genderText: {fontWeight: '600', color: colors.text},
  genderTextActive: {color: '#fff'},
  saveBtn: {
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: {color: '#fff', fontSize: 16, fontWeight: '700'},
});
