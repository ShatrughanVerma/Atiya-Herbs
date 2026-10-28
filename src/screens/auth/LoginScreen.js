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

// Matched to the Atiya Herbs login design (same look as the sign-up screen)
const GREEN = '#125A35';
const GREY = '#5F6A62';
const INPUT_BORDER = '#C5CCC7';
const PLACEHOLDER = '#8A938D';

const validate = ({username, password}) => {
  const errors = {};
  if (!username.trim()) {
    errors.username = 'Please enter your email or username';
  }
  if (!password) {
    errors.password = 'Please enter your password';
  }
  return errors;
};

function Field({error, children}) {
  return (
    <View style={styles.fieldWrap}>
      <View style={[styles.field, error && styles.fieldError]}>{children}</View>
      {!!error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

export default function LoginScreen({navigation}) {
  const [form, setForm] = useState({username: '', password: ''});
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const {signIn} = useAuth();

  const update = (key, value) => {
    setForm(f => ({...f, [key]: value}));
    setErrors(e => ({...e, [key]: undefined}));
  };

  const onLogin = () => {
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }
    // TODO: verify credentials with the store's customer login
    const username = form.username.trim();
    signIn({name: username, email: username.includes('@') ? username : '', provider: 'email'});
    navigation.replace('Main');
  };

  const onForgotPassword = () => {
    // TODO: hook up the password reset flow
    Alert.alert('Forgot password', 'Password reset is coming soon. Please contact support for help.');
  };

  const onApple = () => {
    // TODO: add Apple sign-in (@invertase/react-native-apple-authentication)
    Alert.alert('Coming soon', 'Apple login is not set up yet. Please log in with your email for now.');
  };

  const onGoogle = async () => {
    if (!isGoogleSignInConfigured) {
      Alert.alert('Coming soon', 'Google login is not set up yet. Please log in with your email for now.');
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
    <ImageBackground source={require('../../assets/images/auth_bg.jpg')} style={styles.bg} resizeMode="cover">
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
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

            <View style={styles.card}>
              <Text style={styles.title}>Welcome back</Text>
              <Text style={styles.subtitle}>Log in to continue your natural care journey</Text>

              <Field error={errors.username}>
                <TextInput
                  style={styles.input}
                  placeholder="Email or username"
                  placeholderTextColor={PLACEHOLDER}
                  autoCapitalize="none"
                  autoComplete="username"
                  keyboardType="email-address"
                  returnKeyType="next"
                  value={form.username}
                  onChangeText={v => update('username', v)}
                />
              </Field>

              <Field error={errors.password}>
                <TextInput
                  style={styles.input}
                  placeholder="Password"
                  placeholderTextColor={PLACEHOLDER}
                  autoCapitalize="none"
                  autoComplete="password"
                  secureTextEntry={!showPassword}
                  returnKeyType="done"
                  onSubmitEditing={onLogin}
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

              <Pressable style={styles.forgot} onPress={onForgotPassword} hitSlop={8}>
                <Text style={styles.forgotText}>Forgot Password?</Text>
              </Pressable>

              <Pressable style={styles.loginBtn} onPress={onLogin} accessibilityRole="button">
                <Text style={styles.loginText}>Log in</Text>
              </Pressable>

              <View style={styles.signUpRow}>
                <Text style={styles.signUpText}>Don't have an account? </Text>
                <Pressable onPress={() => navigation.replace('SignUp')} hitSlop={8}>
                  <Text style={styles.signUpLink}>Sign up</Text>
                </Pressable>
              </View>

              <View style={styles.orRow}>
                <View style={styles.orLine} />
                <Text style={styles.orText}>or</Text>
                <View style={styles.orLine} />
              </View>

              <Pressable
                style={styles.appleBtn}
                onPress={onApple}
                accessibilityRole="button"
                accessibilityLabel="Log in with Apple">
                <Icon name="apple" size={26} color="#fff" style={styles.socialIcon} />
                <Text style={styles.appleText}>Log in with Apple</Text>
              </Pressable>

              <Pressable
                style={[styles.googleBtn, googleLoading && styles.googleBtnBusy]}
                onPress={onGoogle}
                disabled={googleLoading}
                accessibilityRole="button"
                accessibilityLabel="Log in with Google">
                {googleLoading ? (
                  <ActivityIndicator color="#111" />
                ) : (
                  <>
                    <Image
                      source={require('../../assets/icons/google.png')}
                      style={styles.googleIcon}
                      resizeMode="contain"
                    />
                    <Text style={styles.googleText}>Log in with Google</Text>
                  </>
                )}
              </Pressable>

              <Pressable style={styles.guestLink} onPress={() => navigation.replace('Main')} hitSlop={8}>
                <Text style={styles.guestText}>Continue as guest</Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: {flex: 1, backgroundColor: GREEN},
  flex: {flex: 1},
  scroll: {flexGrow: 1, paddingBottom: 16},
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
    borderRadius: 28,
    marginHorizontal: 18,
    paddingHorizontal: 22,
    paddingTop: 28,
    paddingBottom: 28,
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
  },
  fieldWrap: {marginBottom: 14},
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 60,
    borderRadius: 30,
    borderWidth: 1.2,
    borderColor: INPUT_BORDER,
    paddingHorizontal: 24,
  },
  fieldError: {borderColor: colors.danger},
  input: {flex: 1, fontFamily: 'Poppins-Regular', fontSize: 17, color: '#1B1B1B', paddingVertical: 0},
  errorText: {fontFamily: 'Poppins-Regular', fontSize: 12, color: colors.danger, marginTop: 4, marginLeft: 20},
  forgot: {alignSelf: 'flex-end', marginTop: 4, marginBottom: 18},
  forgotText: {fontFamily: 'Poppins-Medium', fontSize: 13.5, color: GREY, textDecorationLine: 'underline'},
  loginBtn: {
    height: 58,
    borderRadius: 29,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: GREEN,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: {width: 0, height: 4},
  },
  loginText: {fontFamily: 'Poppins-SemiBold', fontSize: 17, color: '#fff'},
  signUpRow: {flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 20},
  signUpText: {fontFamily: 'Poppins-Regular', fontSize: 15, color: GREY},
  signUpLink: {fontFamily: 'Poppins-SemiBold', fontSize: 15, color: GREEN, textDecorationLine: 'underline'},
  orRow: {flexDirection: 'row', alignItems: 'center', marginVertical: 18},
  orLine: {flex: 1, height: 1, backgroundColor: '#E6E8E6'},
  orText: {fontFamily: 'Poppins-Regular', fontSize: 13, color: '#9AA19C', marginHorizontal: 14},
  appleBtn: {
    height: 58,
    borderRadius: 29,
    backgroundColor: '#000',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  socialIcon: {marginRight: 12},
  appleText: {fontFamily: 'Poppins-Medium', fontSize: 16, color: '#fff'},
  googleBtn: {
    height: 58,
    borderRadius: 29,
    backgroundColor: '#fff',
    borderWidth: 1.2,
    borderColor: '#E3E6E4',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: {width: 0, height: 2},
  },
  googleBtnBusy: {opacity: 0.8},
  googleIcon: {width: 22, height: 22, marginRight: 12},
  googleText: {fontFamily: 'Poppins-Medium', fontSize: 16, color: '#111'},
  guestLink: {alignSelf: 'center', marginTop: 18, paddingVertical: 6},
  guestText: {fontFamily: 'Poppins-Regular', fontSize: 15, color: GREY, textDecorationLine: 'underline'},
});
