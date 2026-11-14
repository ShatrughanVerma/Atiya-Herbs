import React from 'react';
import {Pressable, StyleSheet} from 'react-native';
import {colors} from '../theme';

// The look shared by the customer tabs and the doctor tabs: a white bar that floats above the bottom edge
// with rounded corners and a soft shadow; the open tab is shown in green (no background).

// One tab button
export const FloatingTabButton = ({onPress, onLongPress, accessibilityLabel, children, ...rest}) => {
  const selected = !!rest['aria-selected'];
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityState={{selected}}
      accessibilityLabel={accessibilityLabel}
      style={styles.tab}>
      {children}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  tab: {flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 28, marginVertical: 6, marginHorizontal: 1},
});

// `bottom` = the phone's own bottom inset (from useSafeAreaInsets), so the bar clears the gesture bar / buttons
export const floatingTabOptions = bottom => ({
  headerShown: false,
  tabBarActiveTintColor: colors.primary,
  tabBarInactiveTintColor: colors.muted,
  tabBarButton: FloatingTabButton,
  tabBarAllowFontScaling: false,
  tabBarLabelStyle: {fontSize: 10, fontWeight: '700'},
  tabBarStyle: {
    height: 68,
    marginHorizontal: 14,
    marginBottom: bottom + 8,
    borderRadius: 34,
    backgroundColor: '#fff',
    borderTopWidth: 0,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    shadowColor: '#0B3D1E',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: {width: 0, height: 4},
    elevation: 10,
  },
});
