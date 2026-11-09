import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAuth } from '../../context/AuthContext';
import { colors, spacing } from '../../theme';
import {
  isGoogleSignInConfigured,
  signInWithGoogle,
} from '../../utils/googleAuth';
import useKeyboardHeight from '../../utils/useKeyboardHeight';

// The look shared by the login and sign-up screens (Atiya Herbs login design): logo, a card, compact fields,
// the Apple / Google buttons and "Continue as guest".
export const GREEN = '#125A35';
export const GREY = '#5F6A62';
export const INPUT_BORDER = '#C5CCC7';
export const PLACEHOLDER = '#8A938D';

export function AuthLayout({ title, subtitle, children }) {
  const keyboard = useKeyboardHeight();
  return (
    <View style={styles.bg}>
      <Image
        source={require('../../assets/images/auth_bg.jpg')}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
      />
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: keyboard }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View style={styles.logoCircle}>
              <Image
                source={require('../../assets/images/logo.png')}
                style={styles.logo}
                resizeMode="contain"
                accessibilityLabel="Atiya Herbs logo"
              />
            </View>
            <Text style={styles.tagline}>
              Authentic Ayurvedic & Unani remedies
            </Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
            {children}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// A rounded box with an optional error under it
export function Field({ error, children }) {
  return (
    <View style={styles.fieldWrap}>
      <View style={[styles.field, !!error && styles.fieldError]}>
        {children}
      </View>
      {!!error && (
        <Text style={styles.errorText} accessibilityRole="alert">
          {error}
        </Text>
      )}
    </View>
  );
}

export function MobileField({
  value,
  onChangeText,
  error,
  onSubmit,
  editable,
}) {
  return (
    <Field error={error}>
      <Text style={styles.flag}>🇮🇳</Text>
      <Text style={styles.code}>+91</Text>
      <View style={styles.codeDivider} />
      <TextInput
        style={styles.input}
        placeholder="Mobile number"
        placeholderTextColor={PLACEHOLDER}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        maxLength={16}
        returnKeyType="done"
        editable={editable !== false}
        onSubmitEditing={onSubmit}
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel="Mobile number"
      />
    </Field>
  );
}

export function PrimaryButton({ label, onPress, busy, disabled }) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.primaryBtn,
        (busy || disabled) && styles.primaryBtnOff,
        pressed && styles.pressed,
      ]}
      onPress={onPress}
      disabled={busy || disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {busy ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={styles.primaryText}>{label}</Text>
      )}
    </Pressable>
  );
}

// The password box with a show / hide eye. `newPassword` tells the phone's password manager it is a new one.
export function PasswordField({
  value,
  onChangeText,
  error,
  onSubmit,
  newPassword,
  placeholder = 'Password',
  label,
}) {
  const [shown, setShown] = useState(false);
  return (
    <Field error={error}>
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={PLACEHOLDER}
        autoCapitalize="none"
        autoComplete={newPassword ? 'new-password' : 'password'}
        textContentType={newPassword ? 'newPassword' : 'password'}
        importantForAutofill="yes"
        autoCorrect={false}
        secureTextEntry={!shown}
        maxLength={128}
        returnKeyType="done"
        onSubmitEditing={onSubmit}
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={label || placeholder}
      />
      <Pressable
        onPress={() => setShown(s => !s)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={shown ? 'Hide password' : 'Show password'}
      >
        <Icon
          name={shown ? 'eye-outline' : 'eye-off-outline'}
          size={22}
          color={PLACEHOLDER}
        />
      </Pressable>
    </Field>
  );
}

// Apple, Google and "Continue as guest". `verb` is "Log in" or "Continue".
export function SocialButtons({ navigation, verb }) {
  const { signIn } = useAuth();
  const [googleLoading, setGoogleLoading] = useState(false);

  const onApple = () => {
    // TODO: add Apple sign-in (@invertase/react-native-apple-authentication)
    Alert.alert(
      'Coming soon',
      'Apple login is not set up yet. Please use your email or mobile number for now.',
    );
  };

  const onGoogle = async () => {
    if (!isGoogleSignInConfigured) {
      Alert.alert(
        'Coming soon',
        'Google login is not set up yet. Please use your email or mobile number for now.',
      );
      return;
    }
    setGoogleLoading(true);
    try {
      const result = await signInWithGoogle();
      if (result) {
        // TODO: send result.idToken to the backend to find the customer account
        signIn(result.user);
        navigation.replace('Main');
      }
    } catch (e) {
      Alert.alert('Google sign-in', e.message);
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <>
      <View style={styles.orRow}>
        <View style={styles.orLine} />
        <Text style={styles.orText}>or</Text>
        <View style={styles.orLine} />
      </View>

      <Pressable
        style={({ pressed }) => [styles.appleBtn, pressed && styles.pressed]}
        onPress={onApple}
        accessibilityRole="button"
        accessibilityLabel={`${verb} with Apple`}
      >
        <Icon name="apple" size={22} color="#fff" style={styles.socialIcon} />
        <Text style={styles.appleText}>{verb} with Apple</Text>
      </Pressable>

      <Pressable
        style={({ pressed }) => [
          styles.googleBtn,
          (googleLoading || pressed) && styles.googleBtnBusy,
          pressed && styles.pressed,
        ]}
        onPress={onGoogle}
        disabled={googleLoading}
        accessibilityRole="button"
        accessibilityLabel={`${verb} with Google`}
      >
        {googleLoading ? (
          <ActivityIndicator color="#111" />
        ) : (
          <>
            <Image
              source={require('../../assets/icons/google.png')}
              style={styles.googleIcon}
              resizeMode="contain"
            />
            <Text style={styles.googleText}>{verb} with Google</Text>
          </>
        )}
      </Pressable>

      <Pressable
        style={styles.guestLink}
        onPress={() => navigation.replace('Main')}
        hitSlop={8}
      >
        <Text style={styles.guestText}>Continue as guest</Text>
      </Pressable>
    </>
  );
}

export const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: GREEN },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },
  header: { alignItems: 'center', paddingTop: spacing.lg, paddingBottom: 18 },
  logoCircle: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  // Fixed size: Android ignores aspectRatio on images
  logo: { width: 84, height: 27 },
  tagline: {
    fontFamily: 'Poppins-Regular',
    fontSize: 13.5,
    color: '#fff',
    marginTop: 6,
  },
  card: {
    flexGrow: 1,
    backgroundColor: colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginHorizontal: 24,
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: 14,
  },
  title: {
    fontFamily: 'Poppins-Bold',
    fontSize: 24,
    color: '#1B1B1B',
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'Poppins-Regular',
    fontSize: 14,
    lineHeight: 20,
    color: GREY,
    textAlign: 'center',
    marginTop: 2,
    marginBottom: 12,
    paddingHorizontal: 10,
  },
  fieldWrap: { marginBottom: 7 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 42,
    borderRadius: 21,
    borderWidth: 1.2,
    borderColor: INPUT_BORDER,
    paddingHorizontal: 16,
  },
  fieldError: { borderColor: colors.danger },
  input: {
    flex: 1,
    fontFamily: 'Poppins-Regular',
    fontSize: 15,
    color: '#1B1B1B',
    paddingVertical: 0,
  },
  errorText: {
    fontFamily: 'Poppins-Regular',
    fontSize: 12,
    color: colors.danger,
    marginTop: 4,
    marginLeft: 20,
  },
  flag: { fontSize: 20 },
  code: {
    fontFamily: 'Poppins-Regular',
    fontSize: 15,
    color: '#1B1B1B',
    marginLeft: 8,
  },
  codeDivider: {
    width: 1,
    height: 26,
    backgroundColor: INPUT_BORDER,
    marginHorizontal: 14,
  },
  primaryBtn: {
    minHeight: 40,
    borderRadius: 20,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    elevation: 4,
    shadowColor: GREEN,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  primaryBtnOff: { opacity: 0.6 },
  primaryText: { fontFamily: 'Poppins-SemiBold', fontSize: 15, color: '#fff' },
  link: {
    fontFamily: 'Poppins-SemiBold',
    fontSize: 13.5,
    color: GREEN,
    textDecorationLine: 'underline',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
  },
  rowText: { fontFamily: 'Poppins-Regular', fontSize: 13.5, color: GREY },
  orRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 8 },
  orLine: { flex: 1, height: 1, backgroundColor: '#E6E8E6' },
  orText: {
    fontFamily: 'Poppins-Regular',
    fontSize: 13,
    color: '#9AA19C',
    marginHorizontal: 14,
  },
  googleBtn: {
    minHeight: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1.2,
    borderColor: INPUT_BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleBtnBusy: { opacity: 0.8 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
  appleBtn: {
    minHeight: 40,
    borderRadius: 20,
    backgroundColor: '#000',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  socialIcon: { marginRight: 12 },
  appleText: { fontFamily: 'Poppins-Medium', fontSize: 14.5, color: '#fff' },
  googleIcon: { width: 18, height: 18, marginRight: 12 },
  googleText: { fontFamily: 'Poppins-SemiBold', fontSize: 14.5, color: '#111' },
  guestLink: { alignSelf: 'center', marginTop: 10, paddingVertical: 6 },
  guestText: {
    fontFamily: 'Poppins-Regular',
    fontSize: 13.5,
    color: GREY,
    textDecorationLine: 'underline',
  },
  forgot: { alignSelf: 'flex-end', marginBottom: 8 },
  forgotText: {
    fontFamily: 'Poppins-Medium',
    fontSize: 13,
    color: GREY,
    textDecorationLine: 'underline',
  },
  hint: {
    fontFamily: 'Poppins-Regular',
    fontSize: 12,
    color: GREY,
    marginLeft: 20,
    marginBottom: 6,
  },
  formError: {
    fontFamily: 'Poppins-Regular',
    fontSize: 13,
    color: colors.danger,
    textAlign: 'center',
    marginBottom: 6,
  },
});
