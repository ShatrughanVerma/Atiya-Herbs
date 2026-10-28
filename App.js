import React from 'react';
import {StatusBar} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import {AuthProvider} from './src/context/AuthContext';
import {CartProvider} from './src/context/CartContext';
import {CallProvider} from './src/context/CallContext';
import CallOverlay from './src/components/CallOverlay';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      <AuthProvider>
        <CartProvider>
          <CallProvider>
            <AppNavigator />
            {/* Above every screen, so calls ring and continue wherever the user is */}
            <CallOverlay />
          </CallProvider>
        </CartProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
