import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { AuthProvider } from './src/context/AuthContext';
import { CartProvider } from './src/context/CartContext';
import { CatalogProvider } from './src/context/CatalogContext';
import { CallProvider } from './src/calling/CallContext';
import CallOverlay from './src/calling/CallOverlay';
import { MeetingProvider } from './src/meetings/MeetingContext';
import MeetingRoom from './src/meetings/MeetingRoom';
import MeetingInvite from './src/meetings/MeetingInvite';
import { ConferenceProvider } from './src/conference/ConferenceContext';
import ConferenceRoom from './src/conference/ConferenceRoom';
import ConferenceInvite from './src/conference/ConferenceInvite';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle="dark-content"
        backgroundColor="transparent"
        translucent
      />
      <AuthProvider>
        <CatalogProvider>
          <CartProvider>
          <CallProvider>
            <MeetingProvider>
              <ConferenceProvider>
                <AppNavigator />
                {/* Above every screen, so calls ring and continue wherever the user is */}
                <CallOverlay />
                {/* Conference calls: a call that grew into a group call (Agora) */}
                <ConferenceRoom />
                {/* Someone is adding you to a group call: it rings like a call */}
                <ConferenceInvite />
                {/* Group meetings (Agora), also above every screen while you are in one. Separate from conferences. */}
                <MeetingRoom />
                {/* Someone is adding you to a meeting: it rings like a call */}
                <MeetingInvite />
              </ConferenceProvider>
            </MeetingProvider>
          </CallProvider>
          </CartProvider>
        </CatalogProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
