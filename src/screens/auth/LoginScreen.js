import React from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import {
  AuthLayout,
  Field,
  PasswordField,
  PLACEHOLDER,
  PrimaryButton,
  SocialButtons,
  styles,
} from './authUi';
import { useLoginForm } from './useCredentialAuth';

// Login with an email or mobile number and a password
export default function LoginScreen({ navigation }) {
  const { form, errors, error, busy, update, submit } =
    useLoginForm(navigation);

  const onForgotPassword = () => {
    // TODO: password reset needs an email or SMS service
    Alert.alert(
      'Forgot password',
      'Password reset is coming soon. Please contact support for help.',
    );
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to continue your natural care journey"
    >
      <Field error={errors.identifier}>
        <TextInput
          style={styles.input}
          placeholder="Email or mobile number"
          placeholderTextColor={PLACEHOLDER}
          autoCapitalize="none"
          autoComplete="username"
          textContentType="username"
          importantForAutofill="yes"
          autoCorrect={false}
          maxLength={254}
          keyboardType="email-address"
          returnKeyType="next"
          value={form.identifier}
          onChangeText={v => update('identifier', v)}
          accessibilityLabel="Email or mobile number"
        />
      </Field>

      <PasswordField
        value={form.password}
        onChangeText={v => update('password', v)}
        error={errors.password}
        onSubmit={submit}
      />

      <Pressable
        style={styles.forgot}
        onPress={onForgotPassword}
        hitSlop={8}
        accessibilityRole="button"
      >
        <Text style={styles.forgotText}>Forgot Password?</Text>
      </Pressable>

      {!!error && (
        <Text style={styles.formError} accessibilityRole="alert">
          {error}
        </Text>
      )}
      <PrimaryButton label="Log in" onPress={submit} busy={busy} />

      <View style={styles.row}>
        <Text style={styles.rowText}>Don't have an account? </Text>
        <Pressable onPress={() => navigation.replace('SignUp')} hitSlop={8}>
          <Text style={styles.link}>Sign up</Text>
        </Pressable>
      </View>

      <SocialButtons navigation={navigation} verb="Log in" />
    </AuthLayout>
  );
}
