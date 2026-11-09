import React from 'react';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DoctorAccountScreen from './DoctorAccountScreen';
import DoctorAppointmentsScreen from './DoctorAppointmentsScreen';
import DoctorHomeScreen from './DoctorHomeScreen';
import DoctorPatientsScreen from './DoctorPatientsScreen';
import {colors} from '../theme';

const Tab = createBottomTabNavigator();

const ICONS = {
  Home: ['home', 'home-outline'],
  Appointment: ['calendar-month', 'calendar-month-outline'],
  Patients: ['account-multiple', 'account-multiple-outline'],
  Account: ['account', 'account-outline'],
};

const renderIcon = route => ({focused, color, size}) => <Icon name={ICONS[route.name][focused ? 0 : 1]} size={size + 2} color={color} />;

// What a logged-in doctor sees instead of the shop: Home, Appointment, Patients and Account
export default function DoctorTabs() {
  const {bottom} = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={({route}) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primaryDark,
        tabBarInactiveTintColor: colors.muted,
        tabBarIcon: renderIcon(route),
        tabBarLabelStyle: {fontSize: 12, fontWeight: '600', paddingBottom: 4},
        tabBarStyle: {height: 60 + bottom, paddingBottom: 6 + bottom, paddingTop: 6},
      })}>
      <Tab.Screen name="Home" component={DoctorHomeScreen} />
      <Tab.Screen name="Appointment" component={DoctorAppointmentsScreen} />
      <Tab.Screen name="Patients" component={DoctorPatientsScreen} />
      <Tab.Screen name="Account" component={DoctorAccountScreen} />
    </Tab.Navigator>
  );
}
