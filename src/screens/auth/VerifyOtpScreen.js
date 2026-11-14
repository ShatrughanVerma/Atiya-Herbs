import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import {
  AuthLayout,
  Field,
  PLACEHOLDER,
  PrimaryButton,
  styles,
} from './authUi';
import { useOtpForm } from './useCredentialAuth';

// Asks for the 6-digit code sent by SMS. Used after the password of a login, and before a sign-up creates the account.
export default function VerifyOtpScreen({ navigation, route }) {
  const params = route.params;
  const { code, error, notice, busy, update, submit, resend } = useOtpForm(
    navigation,
    params,
  );
  const signup = params.purpose === 'signup';
  const mobile = signup ? params.details.mobile : params.mobile;

  return (
    <AuthLayout
      title="Verify your number"
      subtitle={`Enter the 6-digit code we sent to +91 ${mobile}`}
    >
      <Field error={error}>
        <TextInput
          style={styles.input}
          placeholder="6-digit code"
          placeholderTextColor={PLACEHOLDER}
          keyboardType="number-pad"
          autoComplete="sms-otp"
          textContentType="oneTimeCode"
          maxLength={6}
          autoFocus
          returnKeyType="done"
          value={code}
          onChangeText={update}
          onSubmitEditing={submit}
          accessibilityLabel="6-digit code"
        />
      </Field>

      {!!notice && <Text style={styles.hint}>{notice}</Text>}
      <PrimaryButton
        label={signup ? 'Verify and create account' : 'Verify and log in'}
        onPress={submit}
        busy={busy}
      />

      <View style={styles.row}>
        {signup ? (
          <>
            <Text style={styles.rowText}>Did not get the code? </Text>
            <Pressable
              onPress={resend}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Resend"
            >
              <Text style={styles.link}>Resend</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text style={styles.link}>Back to log in (sends a new code)</Text>
          </Pressable>
        )}
      </View>
    </AuthLayout>
  );
}
