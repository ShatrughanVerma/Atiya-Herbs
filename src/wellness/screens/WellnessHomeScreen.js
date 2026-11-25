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
import { fz, sz } from '../utils/scale';

const firstName = user => (user?.name || '').trim().split(/\s+/)[0] || 'there';

const hintOf = today => {
  if (today.goals.complete) {
    return 'All goals done today. Well done!';
  }
  return 'Water and mood: keep going!';
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
            <Icon name="chevron-left" size={sz(30)} color={colors.text} />
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
            <Icon name="bell-outline" size={sz(24)} color={colors.text} />
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
            <Icon name="leaf" size={sz(20)} color={colors.primary} />
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
            <Icon name="trophy" size={sz(26)} color="#F5A623" />
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
                <Icon name="water" size={sz(16)} color={BLUE} />
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
                <Icon name="minus" size={sz(16)} color={BLUE} />
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
                <Icon name="pill" size={sz(16)} color={colors.primary} />
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
            <Icon name="gift" size={sz(28)} color="#F57C00" />
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
  scroll: { padding: sz(16), paddingBottom: sz(120) },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: sz(8) },
  headerTitle: { flex: 1, marginLeft: sz(4) },
  bell: { marginRight: sz(14), padding: sz(4) },
  bellDot: { position: 'absolute', top: sz(3), right: sz(3), width: sz(10), height: sz(10), borderRadius: sz(5), backgroundColor: '#E53935', borderWidth: 1.5, borderColor: WELLNESS_BG },
  brand: { fontFamily: 'Poppins-Bold', fontSize: fz(22), color: colors.primary },
  tagline: { fontFamily: 'Poppins-Regular', fontSize: fz(13), color: colors.muted },
  avatar: {
    width: sz(44),
    height: sz(44),
    borderRadius: sz(22),
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: 'Poppins-Bold', fontSize: fz(18), color: colors.primary },
  hello: { fontFamily: 'Poppins-Bold', fontSize: fz(28), color: colors.text, marginTop: sz(8) },
  sub: { fontFamily: 'Poppins-Regular', fontSize: fz(15), color: colors.muted, marginBottom: sz(14) },
  summary: { flexDirection: 'row', alignItems: 'center' },
  ringBig: { fontFamily: 'Poppins-Bold', fontSize: fz(20), color: colors.text },
  ringSmall: { fontFamily: 'Poppins-Regular', fontSize: fz(10), color: colors.muted },
  summaryMid: { flex: 1, marginHorizontal: sz(12) },
  percent: { fontFamily: 'Poppins-Bold', fontSize: fz(26), color: colors.text },
  muted: { fontFamily: 'Poppins-Regular', fontSize: fz(12.5), color: colors.muted },
  hint: { fontFamily: 'Poppins-Regular', fontSize: fz(12), color: colors.muted, marginTop: sz(6) },
  streak: {
    alignItems: 'center',
    backgroundColor: '#E7F8EE',
    borderRadius: sz(16),
    paddingVertical: sz(12),
    paddingHorizontal: sz(6),
    width: sz(84),
  },
  streakNum: { fontFamily: 'Poppins-Bold', fontSize: fz(24), color: colors.text },
  streakLabel: { fontFamily: 'Poppins-Medium', fontSize: fz(11.5), color: colors.text, textAlign: 'center' },
  streakSub: { fontFamily: 'Poppins-Regular', fontSize: fz(10.5), color: colors.muted, textAlign: 'center' },
  pair: { flexDirection: 'row', justifyContent: 'space-between' },
  half: { width: '48.5%', padding: sz(10), marginBottom: sz(10) },
  iconTitle: { flexDirection: 'row', alignItems: 'center', marginBottom: sz(4) },
  iconBox: { width: sz(26), height: sz(26), borderRadius: sz(8), alignItems: 'center', justifyContent: 'center' },
  halfTitle: { fontFamily: 'Poppins-SemiBold', fontSize: fz(12.5), color: colors.text, marginLeft: sz(6), flex: 1 },
  big: { fontFamily: 'Poppins-Bold', fontSize: fz(17), color: colors.text },
  waterBar: { flexDirection: 'row', alignItems: 'center', marginTop: sz(4) },
  waterPct: { fontFamily: 'Poppins-Medium', fontSize: fz(11), color: colors.muted, marginLeft: sz(6) },
  waterBtns: { flexDirection: 'row', marginTop: sz(8) },
  minus: {
    width: sz(30),
    height: sz(30),
    borderRadius: sz(9),
    backgroundColor: BLUE_LIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.4 },
  addWater: {
    flex: 1,
    height: sz(30),
    borderRadius: sz(9),
    backgroundColor: BLUE_LIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: sz(5),
  },
  addWaterText: { fontFamily: 'Poppins-SemiBold', fontSize: fz(12), color: BLUE },
  medBar: { marginTop: sz(6) },
  schedule: {
    height: sz(30),
    borderRadius: sz(9),
    backgroundColor: '#E7F8EE',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: sz(8),
  },
  scheduleText: { fontFamily: 'Poppins-SemiBold', fontSize: fz(12), color: colors.primary },
  question: { fontFamily: 'Poppins-SemiBold', fontSize: fz(16), color: colors.text, marginBottom: sz(12) },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  link: { fontFamily: 'Poppins-Medium', fontSize: fz(13), color: colors.primary },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap' },
  rewardCard: { flexDirection: 'row', alignItems: 'center' },
  rewardIcon: { width: sz(54), height: sz(54), borderRadius: sz(16), backgroundColor: '#FFF1E4', alignItems: 'center', justifyContent: 'center', marginRight: sz(12) },
  rewardPoints: { fontFamily: 'Poppins-Bold', fontSize: fz(20), color: colors.text },
  redeem: { backgroundColor: '#7C3AED', borderRadius: sz(22), paddingHorizontal: sz(14), height: sz(44), alignItems: 'center', justifyContent: 'center', marginLeft: sz(8) },
  redeemText: { fontFamily: 'Poppins-SemiBold', fontSize: fz(13), color: '#fff' },
});
