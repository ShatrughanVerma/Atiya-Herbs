import React from 'react';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DoctorAccountScreen from './DoctorAccountScreen';
import DoctorAppointmentsScreen from './DoctorAppointmentsScreen';
import DoctorHomeScreen from './DoctorHomeScreen';
import DoctorPatientsScreen from './DoctorPatientsScreen';
import DoctorStockScreen from './DoctorStockScreen';
import {floatingTabOptions} from '../navigation/floatingTabBar';

const Tab = createBottomTabNavigator();

const ICONS = {
  Home: ['home', 'home-outline'],
  Appointment: ['calendar-month', 'calendar-month-outline'],
  Patients: ['account-multiple', 'account-multiple-outline'],
  Stock: ['cube', 'cube-outline'],
  Account: ['account', 'account-outline'],
};

const renderIcon = route => ({focused, color}) => <Icon name={ICONS[route.name][focused ? 0 : 1]} size={26} color={color} />;

// What a logged-in doctor sees instead of the shop: Home, Appointment, Patients, Stock and Account.
// The bar floats with rounded corners; the open tab is shown in green.
export default function DoctorTabs() {
  const {bottom} = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={({route}) => ({
        ...floatingTabOptions(bottom),
        tabBarIcon: renderIcon(route),
      })}>
      <Tab.Screen name="Home" component={DoctorHomeScreen} />
      <Tab.Screen name="Appointment" component={DoctorAppointmentsScreen} />
      <Tab.Screen name="Patients" component={DoctorPatientsScreen} />
      <Tab.Screen name="Stock" component={DoctorStockScreen} />
      <Tab.Screen name="Account" component={DoctorAccountScreen} />
    </Tab.Navigator>
  );
}
