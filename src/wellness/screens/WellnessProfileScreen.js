import React from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme';
import useRefresh from '../../utils/useRefresh';
import { BLUE, Card, CardTitle, Chip, WELLNESS_BG } from '../components/parts';
import { useWellness } from '../context/WellnessContext';
import {
  openAlarmSettings,
  openNotificationSettings,
  pickMinutes,
} from '../native/reminders';
import { clock12 } from '../utils/reminderPlan';
import { fz, sz } from '../utils/scale';

const GLASS_SIZES = [150, 200, 250, 300, 500];
const EVERY = [
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 h' },
  { minutes: 90, label: '1.5 h' },
  { minutes: 120, label: '2 h' },
  { minutes: 180, label: '3 h' },
];
const MIN_GLASSES = 1;
const MAX_GLASSES = 30;
const STEP_STEP = 500; // the step goal moves by this much
const MIN_STEP_GOAL = 1000;
const MAX_STEP_GOAL = 50000;

// The person's goals and reminders: Atiya 360, Profile tab.
export default function WellnessProfileScreen({ navigation }) {
  const { user } = useAuth();
  const { today, refresh, updateSettings, notifications, enableNotifications, sendTestReminder } =
    useWellness();
  const pull = useRefresh(refresh);
  const name = user?.name || 'Your account';
  const settings = today?.settings;
  const defaults = today?.defaults;
  const isDefault = key => !!defaults && settings[key] === defaults[key];
  const defaultMark = key =>
    isDefault(key) ? <Text style={styles.mark}> (default)</Text> : null;

  // a time of the day: the phone's time picker, then the new minutes go to the server
  const changeTime = async (key, label) => {
    const picked = await pickMinutes(settings[key]);
    if (picked === null) {
      return;
    }
    const from = key === 'waterFromMin' ? picked : settings.waterFromMin;
    const until = key === 'waterUntilMin' ? picked : settings.waterUntilMin;
    if (from >= until) {
      Alert.alert(label, 'The water reminders must end after they start.');
      return;
    }
    updateSettings({ [key]: picked });
  };

  const timeRow = (label, field) => (
    <Pressable
      key={field}
      style={styles.timeRow}
      onPress={() => changeTime(field, label)}
      accessibilityRole="button"
      accessibilityLabel={`${label} time`}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.timeRight}>
        <Text style={styles.time}>{clock12(settings[field])}</Text>
        {defaultMark(field)}
      </View>
    </Pressable>
  );

  const navRow = (label, onPress) => (
    <Pressable
      key={label}
      style={styles.navRow}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <Icon name="chevron-right" size={sz(18)} color={colors.muted} />
    </Pressable>
  );

  const resetAll = () =>
    Alert.alert(
      "Use the clinic's settings",
      'Go back to the usual goals and reminder times?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Use them', onPress: () => updateSettings({ ...defaults }) },
      ],
    );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={pull.control}
      >
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.sub}>Your goals and reminders</Text>
          </View>
        </View>

        {!settings ? (
          <Card style={styles.card}>
            <Text style={styles.muted}>Pull down to load your goals.</Text>
          </Card>
        ) : (
          <>
            <Card style={styles.card}>
              <CardTitle small icon="bullseye-arrow" iconColor="#F5A623">My goals</CardTitle>
              <View style={styles.goalRow}>
                <View style={styles.flex}>
                  <Text style={styles.label}>Water a day</Text>
                  <Text style={styles.muted}>
                    {(settings.waterGoalGlasses * settings.glassMl).toLocaleString('en-IN')} ml a day
                    {isDefault('waterGoalGlasses') && isDefault('glassMl') ? ' · (default)' : ''}
                  </Text>
                </View>
                <Pressable
                  style={[styles.round, settings.waterGoalGlasses <= MIN_GLASSES && styles.disabled]}
                  disabled={settings.waterGoalGlasses <= MIN_GLASSES}
                  onPress={() => updateSettings({ waterGoalGlasses: settings.waterGoalGlasses - 1 })}
                  accessibilityRole="button"
                  accessibilityLabel="One glass less"
                >
                  <Icon name="minus" size={sz(16)} color={colors.primary} />
                </Pressable>
                <Text style={styles.count}>{settings.waterGoalGlasses} glasses</Text>
                <Pressable
                  style={[styles.round, settings.waterGoalGlasses >= MAX_GLASSES && styles.disabled]}
                  disabled={settings.waterGoalGlasses >= MAX_GLASSES}
                  onPress={() => updateSettings({ waterGoalGlasses: settings.waterGoalGlasses + 1 })}
                  accessibilityRole="button"
                  accessibilityLabel="One glass more"
                >
                  <Icon name="plus" size={sz(16)} color={colors.primary} />
                </Pressable>
              </View>

              <Text style={[styles.rowLabel, styles.gap]}>
                One glass{defaultMark('glassMl')}
              </Text>
              <View style={styles.chips}>
                {GLASS_SIZES.map(ml => (
                  <Chip
                    small
                    key={ml}
                    label={`${ml} ml`}
                    selected={settings.glassMl === ml}
                    onPress={() => updateSettings({ glassMl: ml })}
                  />
                ))}
              </View>

              <View style={[styles.goalRow, styles.gap]}>
                <View style={styles.flex}>
                  <Text style={styles.label}>Steps a day</Text>
                  <Text style={styles.muted}>
                    Per day{isDefault('stepGoal') ? ' · (default)' : ''}
                  </Text>
                </View>
                <Pressable
                  style={[styles.round, settings.stepGoal <= MIN_STEP_GOAL && styles.disabled]}
                  disabled={settings.stepGoal <= MIN_STEP_GOAL}
                  onPress={() => updateSettings({ stepGoal: settings.stepGoal - STEP_STEP })}
                  accessibilityRole="button"
                  accessibilityLabel="Lower the step goal"
                >
                  <Icon name="minus" size={sz(16)} color={colors.primary} />
                </Pressable>
                <Text style={styles.count}>{settings.stepGoal.toLocaleString('en-IN')}</Text>
                <Pressable
                  style={[styles.round, settings.stepGoal >= MAX_STEP_GOAL && styles.disabled]}
                  disabled={settings.stepGoal >= MAX_STEP_GOAL}
                  onPress={() => updateSettings({ stepGoal: settings.stepGoal + STEP_STEP })}
                  accessibilityRole="button"
                  accessibilityLabel="Raise the step goal"
                >
                  <Icon name="plus" size={sz(16)} color={colors.primary} />
                </Pressable>
              </View>
            </Card>

            <Card style={styles.card}>
              <CardTitle small icon="water" iconColor={BLUE}>Water reminders</CardTitle>
              <View style={styles.toggleRow}>
                <Text style={[styles.rowLabel, styles.flex]}>Remind me to drink water</Text>
                <Switch
                  value={settings.waterReminderOn}
                  onValueChange={value => updateSettings({ waterReminderOn: value })}
                  style={styles.switchSmall}
                  trackColor={{ false: '#D1D5DB', true: '#9BD9B3' }}
                  thumbColor={settings.waterReminderOn ? colors.primary : '#F4F4F4'}
                  accessibilityLabel="Water reminders"
                />
              </View>
              {settings.waterReminderOn && (
                <>
                  <Text style={[styles.rowLabel, styles.gap]}>
                    Every{defaultMark('waterEveryMin')}
                  </Text>
                  <View style={styles.chips}>
                    {EVERY.map(item => (
                      <Chip
                        small
                        key={item.minutes}
                        label={item.label}
                        selected={settings.waterEveryMin === item.minutes}
                        onPress={() => updateSettings({ waterEveryMin: item.minutes })}
                      />
                    ))}
                  </View>
                  {timeRow('From', 'waterFromMin')}
                  {timeRow('Until', 'waterUntilMin')}
                </>
              )}
            </Card>

            <Card style={styles.card}>
              <CardTitle small icon="pill">Medicine times</CardTitle>
              <Text style={styles.muted}>
                Medicine reminders ring at these times for the medicines in your prescriptions.
              </Text>
              {timeRow('Morning', 'medMorningMin')}
              {timeRow('Afternoon', 'medAfternoonMin')}
              {timeRow('Evening', 'medEveningMin')}
              {timeRow('Night', 'medNightMin')}
            </Card>

            <Card style={styles.card}>
              <CardTitle small icon="moon-waning-crescent" iconColor="#7E57C2">Evening check-in</CardTitle>
              <View style={styles.toggleRow}>
                <Text style={[styles.rowLabel, styles.flex]}>
                  Remind me to complete the day's check-in
                </Text>
                <Switch
                  value={settings.checkinOn}
                  onValueChange={value => updateSettings({ checkinOn: value })}
                  style={styles.switchSmall}
                  trackColor={{ false: '#D1D5DB', true: '#9BD9B3' }}
                  thumbColor={settings.checkinOn ? colors.primary : '#F4F4F4'}
                  accessibilityLabel="Evening check-in"
                />
              </View>
              {settings.checkinOn && timeRow('At', 'checkinAtMin')}
            </Card>

            <Card style={styles.card}>
              <CardTitle small icon="bell" iconColor="#F5A623">Notifications</CardTitle>
              {notifications.status === 'unsupported' ? (
                <Text style={styles.muted}>Reminders are not available on this phone.</Text>
              ) : notifications.status === 'blocked' ? (
                <>
                  <Text style={styles.muted}>
                    Notifications are off, so your reminders cannot ring. Allow them to get your reminders.
                  </Text>
                  <Pressable
                    style={styles.allow}
                    onPress={enableNotifications}
                    accessibilityRole="button"
                    accessibilityLabel="Allow notifications"
                  >
                    <Text style={styles.allowText}>Allow notifications</Text>
                  </Pressable>
                </>
              ) : notifications.status === 'allowed' && !notifications.onTime ? (
                <Pressable
                  style={styles.warn}
                  onPress={openAlarmSettings}
                  accessibilityRole="button"
                  accessibilityLabel="Allow alarms and reminders"
                >
                  <Text style={styles.warnText}>
                    Reminders may come a few minutes late. Tap to allow "Alarms & reminders" for on-time alerts.
                  </Text>
                </Pressable>
              ) : null}
              {notifications.status !== 'unsupported' && (
                <>
                  {navRow('Send a test reminder', sendTestReminder)}
                  {navRow('Notification settings', openNotificationSettings)}
                </>
              )}
              {navRow('Edit my profile', () => navigation.getParent()?.navigate('EditProfile'))}
            </Card>

            <Pressable
              style={styles.reset}
              onPress={resetAll}
              accessibilityRole="button"
              accessibilityLabel="Use the clinic's settings"
            >
              <Text style={styles.resetText}>Use the clinic's settings</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: WELLNESS_BG },
  flex: { flex: 1 },
  scroll: { padding: sz(10), paddingBottom: sz(100) },
  // the cards of this tab are smaller than the others: less space inside and between them
  card: { padding: sz(10), marginBottom: sz(8), borderRadius: sz(14) },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: sz(8) },
  avatar: {
    width: sz(40),
    height: sz(40),
    borderRadius: sz(20),
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: sz(10),
  },
  avatarText: { fontFamily: 'Poppins-Bold', fontSize: fz(16), color: colors.primary },
  name: { fontFamily: 'Poppins-Bold', fontSize: fz(15.5), color: colors.text },
  sub: { fontFamily: 'Poppins-Regular', fontSize: fz(11.5), color: colors.muted },
  goalRow: { flexDirection: 'row', alignItems: 'center' },
  gap: { marginTop: sz(8) },
  label: { fontFamily: 'Poppins-SemiBold', fontSize: fz(13), color: colors.text },
  rowLabel: { fontFamily: 'Poppins-Regular', fontSize: fz(13), color: colors.text },
  muted: { fontFamily: 'Poppins-Regular', fontSize: fz(11.5), color: colors.muted },
  mark: { fontFamily: 'Poppins-Regular', fontSize: fz(11.5), color: colors.muted },
  switchSmall: { transform: [{ scale: 0.8 }] },
  round: {
    width: sz(28),
    height: sz(28),
    borderRadius: sz(14),
    backgroundColor: '#E7F8EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.4 },
  count: { fontFamily: 'Poppins-SemiBold', fontSize: fz(13), color: colors.text, marginHorizontal: sz(6) },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: sz(4) },
  toggleRow: { flexDirection: 'row', alignItems: 'center' },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: sz(6),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  timeRight: { flexDirection: 'row', alignItems: 'center' },
  time: { fontFamily: 'Poppins-SemiBold', fontSize: fz(13), color: colors.primary },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: sz(8),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
  },
  warn: { backgroundColor: '#FFF3D6', borderRadius: sz(8), padding: sz(8), marginBottom: sz(4) },
  warnText: { fontFamily: 'Poppins-Regular', fontSize: fz(12), color: '#8A5A00' },
  allow: {
    height: sz(34),
    borderRadius: sz(17),
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: sz(8),
    marginBottom: sz(4),
  },
  allowText: { fontFamily: 'Poppins-SemiBold', fontSize: fz(13), color: '#fff' },
  reset: { alignSelf: 'center', paddingVertical: sz(6) },
  resetText: { fontFamily: 'Poppins-Medium', fontSize: fz(13), color: '#E53935' },
});
