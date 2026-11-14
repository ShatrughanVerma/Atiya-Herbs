import { useCallback, useRef, useState } from 'react';
import { normalizeMobile } from '../../calling/phone';
import { useAuth } from '../../context/AuthContext';
import {
  loginWithPassword,
  registerAccount,
  requestSignupOtp,
  verifyLoginOtp,
} from '../../services/authApi';
import { ApiError } from '../../services/http';
import { startSession } from '../../services/session';
import deviceName from '../../utils/deviceName';
import { passwordProblem } from '../../utils/passwordRules';
import { isEmail, NAME_REGEX } from '../../utils/validators';

// The server's field messages (400) as {fieldName: message}, for the names a form has
const serverFields = (error, names) => {
  const found = {};
  if (error instanceof ApiError) {
    for (const name of names) {
      if (error.fields[name]) {
        found[name] = error.fields[name];
      }
    }
  }
  return found;
};

// Login and Sign up with a password. On success the tokens are in the Keystore, the profile is saved and the
// app moves to the Main screen.
function useFinish(navigation) {
  const { completeLogin } = useAuth();
  return useCallback(
    async session => {
      await startSession(session); // the tokens go to the Keystore
      completeLogin(session.user);
      navigation.replace('Main');
    },
    [completeLogin, navigation],
  );
}

// Email or mobile + password
export function useLoginForm(navigation) {
  const finish = useFinish(navigation);
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(''); // a problem that belongs to the whole form
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);

  const update = (key, value) => {
    setForm(f => ({ ...f, [key]: value }));
    setErrors(e => ({ ...e, [key]: undefined }));
    setError('');
  };

  const submit = useCallback(async () => {
    if (sending.current) {
      return;
    }
    const found = {};
    if (!form.identifier.trim()) {
      found.identifier = 'Enter your email or mobile number.';
    }
    if (!form.password) {
      found.password = 'Enter your password.';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await loginWithPassword(
        form.identifier,
        form.password,
        deviceName(),
      );
      if (result.otpRequired) {
        // The password was right: a code went to the phone, the next screen asks for it
        navigation.navigate('VerifyOtp', {
          purpose: 'login',
          challengeToken: result.challengeToken,
          mobile: result.mobile,
        });
      } else {
        await finish(result);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }, [finish, form.identifier, form.password, navigation]);

  return { form, errors, error, busy, update, submit };
}

// Name, email, mobile and password. The account is created on the server (MySQL) by this one call.
export function useSignupForm(navigation) {
  const finish = useFinish(navigation);
  const [form, setForm] = useState({
    name: '',
    email: '',
    mobile: '',
    password: '',
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);

  const update = (key, value) => {
    setForm(f => ({ ...f, [key]: value }));
    setErrors(e => ({ ...e, [key]: undefined }));
    setError('');
  };

  const submit = useCallback(async () => {
    if (sending.current) {
      return;
    }
    const mobile = normalizeMobile(form.mobile);
    const found = {};
    if (!NAME_REGEX.test(form.name.trim())) {
      found.name =
        'Please enter your full name (letters only, 2-60 characters).';
    }
    if (!isEmail(form.email)) {
      found.email = 'Please enter a valid email.';
    }
    if (!mobile) {
      found.mobile = 'Enter a valid 10-digit mobile number.';
    }
    const weak = passwordProblem(form.password);
    if (weak) {
      found.password = weak;
    }
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const details = {
        name: form.name.trim(),
        email: form.email.trim(),
        mobile,
        password: form.password,
      };
      const step = await requestSignupOtp(details);
      if (step.otpRequired) {
        // The code is on its way to the phone: the next screen checks it and then creates the account
        navigation.navigate('VerifyOtp', { purpose: 'signup', details });
      } else {
        await finish(
          await registerAccount({ ...details, deviceName: deviceName() }),
        );
      }
    } catch (e) {
      const named = serverFields(e, ['name', 'email', 'mobile', 'password']);
      if (Object.keys(named).length > 0) {
        setErrors(named);
      } else if (e instanceof ApiError && e.kind === 'conflict') {
        // "This mobile number is already registered" / "This email is already registered": show it under that box
        const box = /mobile/i.test(e.message) ? 'mobile' : 'email';
        setErrors({ [box]: e.message });
      } else {
        setError(e.message);
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }, [finish, form.email, form.mobile, form.name, form.password, navigation]);

  return { form, errors, error, busy, update, submit };
}

// The code step, for a login (purpose 'login') and for a sign-up (purpose 'signup'). On success it ends like the
// password forms do: tokens to the Keystore, profile saved, Main opens.
export function useOtpForm(navigation, params) {
  const finish = useFinish(navigation);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const sending = useRef(false);

  const update = value => {
    setCode(value.replace(/\D/g, '').slice(0, 6));
    setError('');
  };

  const submit = useCallback(async () => {
    if (sending.current) {
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code.');
      return;
    }
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const session =
        params.purpose === 'login'
          ? await verifyLoginOtp(params.challengeToken, code, deviceName())
          : await registerAccount({
              ...params.details,
              code,
              deviceName: deviceName(),
            });
      await finish(session);
    } catch (e) {
      // a conflict means the number or email was taken while the code was on its way
      setError(serverFields(e, ['code']).code || e.message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }, [code, finish, params]);

  // A new code, for a sign-up. (A login asks for the password again instead, which also sends a new code.)
  const resend = useCallback(async () => {
    if (sending.current || params.purpose !== 'signup') {
      return;
    }
    sending.current = true;
    setError('');
    try {
      await requestSignupOtp(params.details);
      setNotice('A new code has been sent.');
    } catch (e) {
      setError(e.message);
    } finally {
      sending.current = false;
    }
  }, [params]);

  return { code, error, notice, busy, update, submit, resend };
}
