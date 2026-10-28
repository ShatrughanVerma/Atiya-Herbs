import React from 'react';
import {Image} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import SplashScreen from '../screens/SplashScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import HomeScreen from '../screens/HomeScreen';
import ExploreScreen from '../screens/ExploreScreen';
import ClinicScreen from '../screens/ClinicScreen';
import ReelsScreen from '../screens/ReelsScreen';
import CartScreen from '../screens/CartScreen';
import ProfileScreen from '../screens/ProfileScreen';
import EditProfileScreen from '../screens/EditProfileScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import SignUpScreen from '../screens/auth/SignUpScreen';
import ProductListScreen from '../screens/shop/ProductListScreen';
import ProductDetailScreen from '../screens/shop/ProductDetailScreen';
import SearchScreen from '../screens/shop/SearchScreen';
import CheckoutScreen from '../screens/shop/CheckoutScreen';
import OrderSuccessScreen from '../screens/shop/OrderSuccessScreen';
import OrdersScreen from '../screens/shop/OrdersScreen';
import WishlistScreen from '../screens/shop/WishlistScreen';
import CallsScreen from '../screens/CallsScreen';
import {useCart} from '../context/CartContext';
import {colors} from '../theme';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function TabIcon({route, focused, color, size}) {
  let source = null;
  if (route.name === 'Home') {
    source = require('../assets/icons/home.png');
  } else if (route.name === 'Reels' || route.name === 'Reel') {
    source = require('../assets/icons/reel.png');
  } else if (route.name === 'Explore') {
    source = require('../assets/icons/explore.png');
  } else if (route.name === 'Clinic') {
    source = require('../assets/icons/location.png');
  } else if (route.name === 'Cart') {
    source = require('../assets/icons/shopping-cart.png');
  } else if (route.name === 'Profile') {
    source = require('../assets/icons/user.png');
  }

  if (source) {
    return (
      <Image
        source={source}
        style={{width: size, height: size, tintColor: color}}
        resizeMode="contain"
      />
    );
  }

  const iconName = focused ? 'compass' : 'compass-outline';
  return <Icon name={iconName} size={size} color={color} />;
}

const renderTabBarIcon = route => ({focused, color, size}) => (
  <TabIcon route={route} focused={focused} color={color} size={size} />
);

function Tabs() {
  const {count} = useCart();
  // Leave room for the phone's own navigation bar (buttons or gesture bar)
  const {bottom} = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={({route}) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarIcon: renderTabBarIcon(route),
        tabBarLabelStyle: {fontSize: 11, fontWeight: '600', paddingBottom: 4},
        tabBarStyle: {height: 60 + bottom, paddingBottom: 6 + bottom, paddingTop: 6},
      })}>
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Reels" component={ReelsScreen} options={{title: 'Reel'}} />
      <Tab.Screen name="Explore" component={ExploreScreen} />
      <Tab.Screen name="Clinic" component={ClinicScreen} />
      <Tab.Screen
        name="Cart"
        component={CartScreen}
        options={{tabBarBadge: count > 0 ? count : undefined}}
      />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Splash" screenOptions={{headerShown: false}}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Main" component={Tabs} />
        <Stack.Screen name="Splash" component={SplashScreen} />
        <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{animation: 'fade'}} />
        <Stack.Screen name="ProductList" component={ProductListScreen} />
        <Stack.Screen name="ProductDetail" component={ProductDetailScreen} />
        <Stack.Screen name="Search" component={SearchScreen} options={{animation: 'fade'}} />
        <Stack.Screen name="Checkout" component={CheckoutScreen} />
        <Stack.Screen name="OrderSuccess" component={OrderSuccessScreen} options={{gestureEnabled: false}} />
        <Stack.Screen name="Orders" component={OrdersScreen} />
        <Stack.Screen name="Wishlist" component={WishlistScreen} />
        <Stack.Screen name="EditProfile" component={EditProfileScreen} />
        <Stack.Screen name="SignUp" component={SignUpScreen} />
        <Stack.Screen name="Calls" component={CallsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
