import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import EmptyState from '../components/shop/EmptyState';
import { useAuth } from '../context/AuthContext';
import { floatingTabOptions } from '../navigation/floatingTabBar';
import { WELLNESS_BG } from './components/parts';
import { WellnessProvider } from './context/WellnessContext';
import HealthScreen from './screens/HealthScreen';
import ReportsScreen from './screens/ReportsScreen';
import RewardsScreen from './screens/RewardsScreen';
import WellnessHomeScreen from './screens/WellnessHomeScreen';
import WellnessProfileScreen from './screens/WellnessProfileScreen';

const Tab = createBottomTabNavigator();

const ICONS = {
  Home: ['home', 'home-outline'],
  Health: ['heart', 'heart-outline'],
  Rewards: ['gift', 'gift-outline'],
  Reports: ['chart-bar', 'chart-bar'],
  Profile: ['account', 'account-outline'],
};

const renderIcon =
  route =>
  ({ focused, color, size }) =>
    (
      <Icon
        name={ICONS[route.name][focused ? 0 : 1]}
        size={size}
        color={color}
      />
    );

function WellnessTabs() {
  // Leave room for the phone's own navigation bar, like the main tabs
  const { bottom } = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        ...floatingTabOptions(bottom),
        tabBarIcon: renderIcon(route),
      })}
    >
      <Tab.Screen name="Home" component={WellnessHomeScreen} />
      <Tab.Screen name="Health" component={HealthScreen} />
      <Tab.Screen name="Rewards" component={RewardsScreen} />
      <Tab.Screen name="Reports" component={ReportsScreen} />
      <Tab.Screen name="Profile" component={WellnessProfileScreen} />
    </Tab.Navigator>
  );
}

// Atiya 360: the Health Wellness module. Opened by the "Health Wellness" button of the Home screen. It needs a login,
// because everything is saved in the person's account.
export default function WellnessNavigator({ navigation }) {
  const { user } = useAuth();
  if (!user) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <EmptyState
          icon="account-lock-outline"
          title="Log in to use Health Wellness"
          note="Your water, mood and goals are saved in your account."
          actionLabel="Log in"
          onAction={() => navigation.replace('Login')}
        />
      </SafeAreaView>
    );
  }
  return (
    <WellnessProvider>
      <WellnessTabs />
    </WellnessProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: WELLNESS_BG },
});
