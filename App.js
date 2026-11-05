import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { AuthProvider } from './src/context/AuthContext';
import { CartProvider } from './src/context/CartContext';
import { CallProvider } from './src/calling/CallContext';
import CallOverlay from './src/calling/CallOverlay';
import { MeetingProvider } from './src/meetings/MeetingContext';
import MeetingRoom from './src/meetings/MeetingRoom';
import MeetingInvite from './src/meetings/MeetingInvite';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle="dark-content"
        backgroundColor="transparent"
        translucent
      />
      <AuthProvider>
        <CartProvider>
          <CallProvider>
            <MeetingProvider>
              <AppNavigator />
              {/* Above every screen, so calls ring and continue wherever the user is */}
              <CallOverlay />
              {/* Group meetings (Agora), also above every screen while you are in one */}
              <MeetingRoom />
              {/* Someone is adding you to a group call: it rings like a call */}
              <MeetingInvite />
            </MeetingProvider>
          </CallProvider>
        </CartProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
