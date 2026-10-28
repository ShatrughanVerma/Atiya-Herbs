import React, {useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useAuth} from '../../context/AuthContext';
import {colors, spacing} from '../../theme';
import {isGoogleSignInConfigured, signInWithGoogle} from '../../utils/googleAuth';

// Matched to the Atiya Herbs sign-up design
const GREEN = '#125A35';
const GREY = '#5F6A62';
const INPUT_BORDER = '#C5CCC7';
const PLACEHOLDER = '#8A938D';

const validate = ({name, email, password, mobile}) => {
  const errors = {};
  if (name.trim().length < 2) {
    errors.name = 'Please enter your full name';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    errors.email = 'Please enter a valid email';
  }
  if (password.length < 8 || password.length > 64) {
    errors.password = 'Password must be 8–64 characters';
  }
  if (!/^[6-9][0-9]{9}$/.test(mobile)) {
    errors.mobile = 'Please enter a valid 10-digit mobile number';
  }
  return errors;
};

function Field({error, children, style}) {
  return (
    <View style={styles.fieldWrap}>
      <View style={[styles.field, error && styles.fieldError, style]}>{children}</View>
      {!!error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

export default function SignUpScreen({navigation}) {
  const [form, setForm] = useState({name: '', email: '', password: '', mobile: ''});
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const {signIn} = useAuth();

  const onGoogle = async () => {
    if (!isGoogleSignInConfigured) {
      Alert.alert('Coming soon', 'Google sign-up is not set up yet. Please sign up with your email for now.');
      return;
    }
    setGoogleLoading(true);
    try {
      const result = await signInWithGoogle();
      if (result) {
        // TODO: send result.idToken to the backend to create or find the customer account
        signIn(result.user);
        navigation.replace('Main');
      }
    } catch (e) {
      Alert.alert('Google sign-in', e.message);
    } finally {
      setGoogleLoading(false);
    }
  };

  const update = (key, value) => {
    setForm(f => ({...f, [key]: key === 'mobile' ? value.replace(/[^0-9]/g, '') : value}));
    setErrors(e => ({...e, [key]: undefined}));
  };

  const onSignUp = () => {
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }
    // TODO: create the customer account on the backend (OTP verify the mobile number first)
    signIn({name: form.name.trim(), email: form.email.trim(), mobile: form.mobile, provider: 'email'});
    navigation.replace('Main');
  };

  return (
    <ImageBackground source={require('../../assets/images/auth_bg.jpg')} style={styles.bg} resizeMode="cover">
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.flex} edges={['top']}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <View style={styles.header}>
              <View style={styles.logoCircle}>
                <Image
                  source={require('../../assets/images/logo.png')}
                  style={styles.logo}
                  resizeMode="contain"
                  accessibilityLabel="Atiya Herbs logo"
                />
              </View>
              <Text style={styles.tagline}>Authentic Ayurvedic & Unani remedies</Text>
            </View>

            <SafeAreaView style={styles.card} edges={['bottom']}>
              <Text style={styles.title}>Create account</Text>
              <Text style={styles.subtitle}>Join Atiya Herbs for authentic herbal remedies</Text>

              <Field error={errors.name}>
                <TextInput
                  style={styles.input}
                  placeholder="Full name"
                  placeholderTextColor={PLACEHOLDER}
                  autoCapitalize="words"
                  autoComplete="name"
                  value={form.name}
                  onChangeText={v => update('name', v)}
                />
              </Field>

              <Field error={errors.email}>
                <TextInput
                  style={styles.input}
                  placeholder="Email"
                  placeholderTextColor={PLACEHOLDER}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  value={form.email}
                  onChangeText={v => update('email', v)}
                />
              </Field>

              <Field error={errors.password}>
                <TextInput
                  style={styles.input}
                  placeholder="Password (8-64 characters)"
                  placeholderTextColor={PLACEHOLDER}
                  autoCapitalize="none"
                  autoComplete="new-password"
                  secureTextEntry={!showPassword}
                  maxLength={64}
                  value={form.password}
                  onChangeText={v => update('password', v)}
                />
                <Pressable
                  onPress={() => setShowPassword(s => !s)}
                  hitSlop={10}
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}>
                  <Icon name={showPassword ? 'eye-outline' : 'eye-off-outline'} size={24} color={PLACEHOLDER} />
                </Pressable>
              </Field>

              <Field error={errors.mobile}>
                <Text style={styles.flag}>🇮🇳</Text>
                <Text style={styles.code}>+91</Text>
                <View style={styles.codeDivider} />
                <TextInput
                  style={styles.input}
                  placeholder="Mobile number"
                  placeholderTextColor={PLACEHOLDER}
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  maxLength={10}
                  value={form.mobile}
                  onChangeText={v => update('mobile', v)}
                />
              </Field>

              <Pressable style={styles.signUpBtn} onPress={onSignUp}>
                <Text style={styles.signUpText}>Sign up</Text>
              </Pressable>

              <View style={styles.loginRow}>
                <Text style={styles.loginText}>Already have an account? </Text>
                <Pressable onPress={() => navigation.replace('Login')} hitSlop={8}>
                  <Text style={styles.loginLink}>Log in</Text>
                </Pressable>
              </View>

              <View style={styles.orRow}>
                <View style={styles.orLine} />
                <Text style={styles.orText}>or</Text>
                <View style={styles.orLine} />
              </View>

              <Pressable
                style={[styles.googleBtn, googleLoading && styles.googleBtnBusy]}
                onPress={onGoogle}
                disabled={googleLoading}
                accessibilityRole="button"
                accessibilityLabel="Continue with Google">
                {googleLoading ? (
                  <ActivityIndicator color="#111" />
                ) : (
                  <>
                    <Image
                      source={require('../../assets/icons/google.png')}
                      style={styles.googleIcon}
                      resizeMode="contain"
                    />
                    <Text style={styles.googleText}>Continue with Google</Text>
                  </>
                )}
              </Pressable>

              <Pressable style={styles.guestLink} onPress={() => navigation.replace('Main')} hitSlop={8}>
                <Text style={styles.guestText}>Continue as guest</Text>
              </Pressable>
            </SafeAreaView>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: {flex: 1, backgroundColor: GREEN},
  flex: {flex: 1},
  scroll: {flexGrow: 1},
  header: {alignItems: 'center', paddingTop: spacing.lg, paddingBottom: 28},
  logoCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: {width: 0, height: 4},
  },
  // Fixed size: Android ignores aspectRatio on images
  logo: {width: 96, height: 31},
  tagline: {fontFamily: 'Poppins-Regular', fontSize: 15, color: '#fff', marginTop: 16},
  card: {
    flexGrow: 1,
    backgroundColor: colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginHorizontal: 18,
    paddingHorizontal: 22,
    paddingTop: 28,
    paddingBottom: 40,
  },
  title: {fontFamily: 'Poppins-Bold', fontSize: 30, color: '#1B1B1B', textAlign: 'center'},
  subtitle: {
    fontFamily: 'Poppins-Regular',
    fontSize: 15.5,
    lineHeight: 23,
    color: GREY,
    textAlign: 'center',
    marginTop: 2,
    marginBottom: 20,
    paddingHorizontal: 10,
  },
  fieldWrap: {marginBottom: 14},
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 60,
    borderRadius: 30,
    borderWidth: 1.2,
    borderColor: INPUT_BORDER,
    paddingHorizontal: 20,
  },
  fieldError: {borderColor: colors.danger},
  input: {flex: 1, fontFamily: 'Poppins-Regular', fontSize: 17, color: '#1B1B1B', paddingVertical: 0},
  errorText: {fontFamily: 'Poppins-Regular', fontSize: 12, color: colors.danger, marginTop: 4, marginLeft: 20},
  flag: {fontSize: 20},
  code: {fontFamily: 'Poppins-Regular', fontSize: 17, color: '#1B1B1B', marginLeft: 8},
  codeDivider: {width: 1, height: 26, backgroundColor: INPUT_BORDER, marginHorizontal: 14},
  signUpBtn: {
    height: 58,
    borderRadius: 29,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    elevation: 4,
    shadowColor: GREEN,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: {width: 0, height: 4},
  },
  signUpText: {fontFamily: 'Poppins-SemiBold', fontSize: 17, color: '#fff'},
  loginRow: {flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 20},
  loginText: {fontFamily: 'Poppins-Regular', fontSize: 15, color: GREY},
  loginLink: {fontFamily: 'Poppins-SemiBold', fontSize: 15, color: GREEN, textDecorationLine: 'underline'},
  orRow: {flexDirection: 'row', alignItems: 'center', marginVertical: 18},
  orLine: {flex: 1, height: 1, backgroundColor: '#E6E8E6'},
  orText: {fontFamily: 'Poppins-Regular', fontSize: 13, color: '#9AA19C', marginHorizontal: 14},
  googleBtn: {
    height: 58,
    borderRadius: 29,
    backgroundColor: '#fff',
    borderWidth: 1.2,
    borderColor: INPUT_BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleBtnBusy: {opacity: 0.8},
  googleIcon: {width: 22, height: 22, marginRight: 12},
  googleText: {fontFamily: 'Poppins-SemiBold', fontSize: 16, color: '#111'},
  guestLink: {alignSelf: 'center', marginTop: 18, paddingVertical: 6},
  guestText: {fontFamily: 'Poppins-Regular', fontSize: 15, color: GREY, textDecorationLine: 'underline'},
});
