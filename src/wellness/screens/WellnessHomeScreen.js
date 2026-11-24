import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import EmptyState from '../../components/shop/EmptyState';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme';
import useRefresh from '../../utils/useRefresh';
import {
  BLUE,
  BLUE_LIGHT,
  Card,
  CardTitle,
  GoalRing,
  MoodPicker,
  ProgressBar,
  WELLNESS_BG,
  WeekBars,
} from '../components/parts';
import BadgeCircle from '../components/BadgeCircle';
import { StepsCard, WalkCard } from '../components/StepsWalk';
import { useWellness } from '../context/WellnessContext';
import { weekdayShort } from '../utils/dates';

const firstName = user => (user?.name || '').trim().split(/\s+/)[0] || 'there';

const hintOf = today => {
  if (today.goals.complete) {
    return 'All goals done today. Well done!';
  }
  return 'Water, medicines and mood: keep going!';
};

export default function WellnessHomeScreen({ navigation }) {
  const { user } = useAuth();
  const { today, status, refresh, addWater, setMood, notifications } = useWellness();
  const pull = useRefresh(refresh);

  if (!today) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {status === 'error' ? (
          <EmptyState
            icon="cloud-off-outline"
            title="Could not load your wellness"
            note="Please check your internet and try again."
            actionLabel="Retry"
            onAction={refresh}
          />
        ) : (
          <EmptyState icon="heart-pulse" title="Loading your wellness..." />
        )}
      </SafeAreaView>
    );
  }

  const glass = today.settings.glassMl;
  const initial = firstName(user).charAt(0).toUpperCase();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={pull.control}
      >
        <View style={styles.header}>
          <Pressable
            onPress={() => navigation.getParent()?.goBack()}
            hitSlop={10}
            accessibilityLabel="Back"
          >
            <Icon name="chevron-left" size={30} color={colors.text} />
          </Pressable>
          <View style={styles.headerTitle}>
            <Text style={styles.brand}>Atiya 360</Text>
            <Text style={styles.tagline}>Live Healthy. Live Better.</Text>
          </View>
          <Pressable
            style={styles.bell}
            onPress={() => navigation.navigate('Profile')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
          >
            <Icon name="bell-outline" size={24} color={colors.text} />
            {/* a red dot while notifications are off: the reminders cannot ring */}
            {notifications.status === 'blocked' && <View style={styles.bellDot} accessibilityLabel="Notifications are off" />}
          </Pressable>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
        </View>

        <Text style={styles.hello}>Hello {firstName(user)}!</Text>
        <Text style={styles.sub}>Your daily wellness at a glance</Text>

        <Card style={styles.summary}>
          <GoalRing percent={today.goals.percent}>
            <Icon name="leaf" size={20} color={colors.primary} />
            <Text style={styles.ringBig}>
              {today.goals.done}/{today.goals.total}
            </Text>
            <Text style={styles.ringSmall}>Goals today</Text>
          </GoalRing>
          <View style={styles.summaryMid}>
            <Text style={styles.percent}>{today.goals.percent}%</Text>
            <Text style={styles.muted}>of today's goals</Text>
            <ProgressBar percent={today.goals.percent} />
            <Text style={styles.hint}>{hintOf(today)}</Text>
          </View>
          <View style={styles.streak}>
            <Icon name="trophy" size={26} color="#F5A623" />
            <Text style={styles.streakNum}>{today.streak.current}</Text>
            <Text style={styles.streakLabel} numberOfLines={1}>Day streak</Text>
            <Text style={styles.streakSub}>
              {today.streak.current > 0 ? 'Keep it up!' : 'Start today!'}
            </Text>
          </View>
        </Card>

        <View style={styles.pair}>
          <Card style={styles.half}>
            <View style={styles.iconTitle}>
              <View style={[styles.iconBox, { backgroundColor: BLUE_LIGHT }]}>
                <Icon name="water" size={22} color={BLUE} />
              </View>
              <Text style={styles.halfTitle}>Water intake</Text>
            </View>
            <Text style={styles.big}>{today.water.ml.toLocaleString('en-IN')} ml</Text>
            <Text style={styles.muted}>
              of {today.water.goalMl.toLocaleString('en-IN')} ml
            </Text>
            <View style={styles.waterBar}>
              <View style={styles.flex}>
                <ProgressBar percent={today.water.percent} color={BLUE} />
              </View>
              <Text style={styles.waterPct}>{today.water.percent}%</Text>
            </View>
            <View style={styles.waterBtns}>
              <Pressable
                style={[styles.minus, today.water.ml === 0 && styles.disabled]}
                disabled={today.water.ml === 0}
                onPress={() => addWater(-glass)}
                accessibilityRole="button"
                accessibilityLabel="Take one glass back"
              >
                <Icon name="minus" size={20} color={BLUE} />
              </Pressable>
              <Pressable
                style={styles.addWater}
                onPress={() => addWater(glass)}
                accessibilityRole="button"
                accessibilityLabel="Add water"
              >
                <Text style={styles.addWaterText} numberOfLines={1}>+ Add water</Text>
              </Pressable>
            </View>
          </Card>

          <Card style={styles.half}>
            <View style={styles.iconTitle}>
              <View style={[styles.iconBox, { backgroundColor: colors.primaryLight }]}>
                <Icon name="pill" size={22} color={colors.primary} />
              </View>
              <Text style={styles.halfTitle}>Medicine adherence</Text>
            </View>
            <Text style={styles.big}>—</Text>
            <Text style={styles.muted}>No medicines today</Text>
            <View style={styles.medBar}>
              <ProgressBar percent={0} />
            </View>
            <Pressable
              style={styles.schedule}
              onPress={() => navigation.navigate('Health')}
              accessibilityRole="button"
            >
              <Text style={styles.scheduleText}>View schedule</Text>
            </Pressable>
          </Card>
        </View>

        <Card>
          <Text style={styles.question}>How are you feeling today?</Text>
          <MoodPicker mood={today.mood} onChange={setMood} />
        </Card>

        <Card>
          <View style={styles.rowBetween}>
            <CardTitle icon="star" iconColor="#F5A623">Your achievements</CardTitle>
            <Pressable onPress={() => navigation.navigate('Rewards')} hitSlop={8} accessibilityRole="button" accessibilityLabel="See all achievements">
              <Text style={styles.link}>See all →</Text>
            </Pressable>
          </View>
          <View style={styles.badgeRow}>
            {today.rewards.badges.map(badge => (
              <BadgeCircle key={badge.id} badge={badge} />
            ))}
          </View>
        </Card>

        <Card style={styles.rewardCard}>
          <View style={styles.rewardIcon}>
            <Icon name="gift" size={28} color="#F57C00" />
          </View>
          <View style={styles.flex}>
            <Text style={styles.muted}>Reward points</Text>
            <Text style={styles.rewardPoints} accessibilityLabel="Reward points">
              {today.rewards.balance.toLocaleString('en-IN')} Points
            </Text>
            <Text style={styles.muted}>Get up to Rs {today.rewards.rupees} in your wallet</Text>
          </View>
          <Pressable
            style={styles.redeem}
            onPress={() => navigation.navigate('Rewards')}
            accessibilityRole="button"
            accessibilityLabel="Redeem rewards"
          >
            <Text style={styles.redeemText}>Redeem rewards →</Text>
          </Pressable>
        </Card>

        <StepsCard />
        <WalkCard />

        <Card>
          <View style={styles.rowBetween}>
            <CardTitle icon="chart-bar">Weekly water (glasses)</CardTitle>
            <Pressable onPress={() => navigation.navigate('Health')} hitSlop={8}>
              <Text style={styles.link}>View details →</Text>
            </Pressable>
          </View>
          <WeekBars
            week={today.week}
            labelOf={weekdayShort}
            goal={today.water.goalGlasses}
          />
        </Card>

        <Card>
          <CardTitle icon="shoe-print" iconColor="#F57C00">Weekly steps</CardTitle>
          <WeekBars
            week={today.week}
            labelOf={weekdayShort}
            goal={today.steps.goal}
            getValue={d => d.steps}
          />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: WELLNESS_BG },
  flex: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 120 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  headerTitle: { flex: 1, marginLeft: 4 },
  bell: { marginRight: 14, padding: 4 },
  bellDot: { position: 'absolute', top: 3, right: 3, width: 10, height: 10, borderRadius: 5, backgroundColor: '#E53935', borderWidth: 1.5, borderColor: WELLNESS_BG },
  brand: { fontFamily: 'Poppins-Bold', fontSize: 22, color: colors.primary },
  tagline: { fontFamily: 'Poppins-Regular', fontSize: 13, color: colors.muted },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: 'Poppins-Bold', fontSize: 18, color: colors.primary },
  hello: { fontFamily: 'Poppins-Bold', fontSize: 28, color: colors.text, marginTop: 8 },
  sub: { fontFamily: 'Poppins-Regular', fontSize: 15, color: colors.muted, marginBottom: 14 },
  summary: { flexDirection: 'row', alignItems: 'center' },
  ringBig: { fontFamily: 'Poppins-Bold', fontSize: 20, color: colors.text },
  ringSmall: { fontFamily: 'Poppins-Regular', fontSize: 10, color: colors.muted },
  summaryMid: { flex: 1, marginHorizontal: 12 },
  percent: { fontFamily: 'Poppins-Bold', fontSize: 26, color: colors.text },
  muted: { fontFamily: 'Poppins-Regular', fontSize: 12.5, color: colors.muted },
  hint: { fontFamily: 'Poppins-Regular', fontSize: 12, color: colors.muted, marginTop: 6 },
  streak: {
    alignItems: 'center',
    backgroundColor: '#E7F8EE',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 6,
    width: 84,
  },
  streakNum: { fontFamily: 'Poppins-Bold', fontSize: 24, color: colors.text },
  streakLabel: { fontFamily: 'Poppins-Medium', fontSize: 11.5, color: colors.text, textAlign: 'center' },
  streakSub: { fontFamily: 'Poppins-Regular', fontSize: 10.5, color: colors.muted, textAlign: 'center' },
  pair: { flexDirection: 'row', justifyContent: 'space-between' },
  half: { width: '48.5%' },
  iconTitle: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  iconBox: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  halfTitle: { fontFamily: 'Poppins-SemiBold', fontSize: 13.5, color: colors.text, marginLeft: 8, flex: 1 },
  big: { fontFamily: 'Poppins-Bold', fontSize: 22, color: colors.text },
  waterBar: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  waterPct: { fontFamily: 'Poppins-Medium', fontSize: 12, color: colors.muted, marginLeft: 8 },
  waterBtns: { flexDirection: 'row', marginTop: 12 },
  minus: {
    width: 38,
    height: 42,
    borderRadius: 14,
    backgroundColor: BLUE_LIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.4 },
  addWater: {
    flex: 1,
    height: 42,
    borderRadius: 14,
    backgroundColor: BLUE_LIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  addWaterText: { fontFamily: 'Poppins-SemiBold', fontSize: 13, color: BLUE },
  medBar: { marginTop: 22 },
  schedule: {
    height: 44,
    borderRadius: 14,
    backgroundColor: '#E7F8EE',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  scheduleText: { fontFamily: 'Poppins-SemiBold', fontSize: 14, color: colors.primary },
  question: { fontFamily: 'Poppins-SemiBold', fontSize: 16, color: colors.text, marginBottom: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  link: { fontFamily: 'Poppins-Medium', fontSize: 13, color: colors.primary },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap' },
  rewardCard: { flexDirection: 'row', alignItems: 'center' },
  rewardIcon: { width: 54, height: 54, borderRadius: 16, backgroundColor: '#FFF1E4', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  rewardPoints: { fontFamily: 'Poppins-Bold', fontSize: 20, color: colors.text },
  redeem: { backgroundColor: '#7C3AED', borderRadius: 22, paddingHorizontal: 14, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  redeemText: { fontFamily: 'Poppins-SemiBold', fontSize: 13, color: '#fff' },
});
