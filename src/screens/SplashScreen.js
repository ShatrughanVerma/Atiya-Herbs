import React, {useEffect, useRef} from 'react';
import {ActivityIndicator, Animated, Image, StyleSheet, Text, View} from 'react-native';
import {colors} from '../theme';

export default function SplashScreen({navigation}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.85)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {toValue: 1, duration: 800, useNativeDriver: true}),
      Animated.spring(scale, {toValue: 1, useNativeDriver: true}),
    ]).start();
    const timer = setTimeout(() => navigation.replace('Onboarding'), 2500);
    return () => clearTimeout(timer);
  }, [navigation, opacity, scale]);

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.content, {opacity, transform: [{scale}]}]}>
        <Image
          source={require('../assets/images/logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.tagline}>Pure Herbs • Better Life</Text>
      </Animated.View>

      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9F8F5',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    alignItems: 'center',
    width: '100%',
  },
  // Fixed size: Android ignores aspectRatio on images and draws them at full size
  logo: {
    width: 220,
    height: 71,
  },
  tagline: {
    marginTop: 16,
    fontSize: 14,
    color: colors.muted,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  loadingContainer: {
    position: 'absolute',
    bottom: 60,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 8,
    fontSize: 12,
    color: colors.muted,
    fontWeight: '500',
  },
});
