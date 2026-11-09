import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { PASSWORD_HINT } from '../../utils/passwordRules';
import {
  AuthLayout,
  Field,
  MobileField,
  PasswordField,
  PLACEHOLDER,
  PrimaryButton,
  SocialButtons,
  styles,
} from './authUi';
import { useSignupForm } from './useCredentialAuth';

// Sign up: name, email, mobile and a password. The account is saved on the server.
export default function SignUpScreen({ navigation }) {
  const { form, errors, error, busy, update, submit } =
    useSignupForm(navigation);

  return (
    <AuthLayout
      title="Create account"
      subtitle="Join Atiya Herbs for authentic herbal remedies"
    >
      <Field error={errors.name}>
        <TextInput
          style={styles.input}
          placeholder="Full name"
          placeholderTextColor={PLACEHOLDER}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          maxLength={60}
          returnKeyType="next"
          value={form.name}
          onChangeText={v => update('name', v)}
          accessibilityLabel="Full name"
        />
      </Field>

      <Field error={errors.email}>
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={PLACEHOLDER}
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          autoCorrect={false}
          maxLength={254}
          keyboardType="email-address"
          returnKeyType="next"
          value={form.email}
          onChangeText={v => update('email', v)}
          accessibilityLabel="Email"
        />
      </Field>

      <MobileField
        value={form.mobile}
        onChangeText={v => update('mobile', v)}
        error={errors.mobile}
      />

      <PasswordField
        value={form.password}
        onChangeText={v => update('password', v)}
        error={errors.password}
        onSubmit={submit}
        newPassword
        placeholder="Create a password"
      />
      {!errors.password && <Text style={styles.hint}>{PASSWORD_HINT}</Text>}

      {!!error && (
        <Text style={styles.formError} accessibilityRole="alert">
          {error}
        </Text>
      )}
      <PrimaryButton label="Create account" onPress={submit} busy={busy} />

      <View style={styles.row}>
        <Text style={styles.rowText}>Already have an account? </Text>
        <Pressable onPress={() => navigation.replace('Login')} hitSlop={8}>
          <Text style={styles.link}>Log in</Text>
        </Pressable>
      </View>

      <SocialButtons navigation={navigation} verb="Continue" />
    </AuthLayout>
  );
}
