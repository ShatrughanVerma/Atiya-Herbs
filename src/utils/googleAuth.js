import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import {GOOGLE_WEB_CLIENT_ID} from '../config/auth';

export const isGoogleSignInConfigured = GOOGLE_WEB_CLIENT_ID.length > 0;

let configured = false;
const ensureConfigured = () => {
  if (!configured) {
    // webClientId makes Google return an idToken the backend can verify
    GoogleSignin.configure({webClientId: GOOGLE_WEB_CLIENT_ID, scopes: ['profile', 'email']});
    configured = true;
  }
};

/**
 * Opens Google's account picker.
 * Resolves to {user: {name, email, photo, provider}, idToken}, or null if the user closed the picker.
 * Rejects with an Error whose message is safe to show to the user.
 */
export async function signInWithGoogle() {
  ensureConfigured();
  try {
    await GoogleSignin.hasPlayServices({showPlayServicesUpdateDialog: true});
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) {
      return null; // cancelled
    }
    const {user, idToken} = response.data;
    return {
      user: {name: user.name || user.email, email: user.email, photo: user.photo, provider: 'google'},
      idToken,
    };
  } catch (error) {
    if (isErrorWithCode(error)) {
      if (error.code === statusCodes.IN_PROGRESS) {
        return null;
      }
      if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new Error('Google Play Services is not available or needs an update on this phone.');
      }
      if (error.code === '10' || error.code === 10) {
        // DEVELOPER_ERROR: package name / SHA-1 / client ID do not match the Google Cloud setup
        throw new Error('Google sign-in is not set up correctly for this app yet.');
      }
    }
    throw new Error('Could not sign in with Google. Please check your internet and try again.');
  }
}

export async function signOutFromGoogle() {
  ensureConfigured();
  try {
    await GoogleSignin.signOut();
  } catch {
    // Already signed out
  }
}
