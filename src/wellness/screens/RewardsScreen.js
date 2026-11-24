import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import EmptyState from '../../components/shop/EmptyState';
import { colors } from '../../theme';
import useRefresh from '../../utils/useRefresh';
import BadgeCircle from '../components/BadgeCircle';
import { Card, CardTitle, Chip, ProgressBar, WELLNESS_BG } from '../components/parts';
import { useWellness } from '../context/WellnessContext';
import { fetchRewards, redeemPoints } from '../services/wellnessApi';
import { shortDay } from '../utils/dates';

const PURPLE = '#7C3AED';
const ORANGE = '#F57C00';
const EARN_ICONS = {
  water: 'water',
  steps: 'shoe-print',
  complete: 'check-circle',
  streak: 'fire',
  badge: 'medal',
  challenge: 'flag-checkered',
};
const EARN_COLORS = { water: '#2F80ED', steps: ORANGE, complete: colors.primary, streak: ORANGE, badge: '#F5A623', challenge: PURPLE };
const fmt = n => n.toLocaleString('en-IN');

// Points, wallet, badges and challenges: Atiya 360, Rewards tab.
export default function RewardsScreen() {
  const { today, refresh } = useWellness();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState('points'); // points | wallet
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await fetchRewards());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // a glass of water or a mood can win points: look again when today's numbers change
  const signature = today ? `${today.rewards.balance}|${today.rewards.badgesEarned}` : '';
  useEffect(() => {
    if (signature) {
      load();
    }
  }, [signature, load]);

  const pull = useRefresh(() => Promise.all([refresh(), load()]));

  const onRedeem = async () => {
    setBusy(true);
    try {
      const result = await redeemPoints(data.redeem.points);
      setData(result);
      Alert.alert('Added to your wallet', `Rs ${result.added} added. You can use it as a discount when you book an appointment.`);
      refresh(); // the points on the Home screen
    } catch (e) {
      Alert.alert('Could not add to the wallet', e.message || 'Please try again.');
      load();
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Text style={styles.title}>Rewards</Text>
        <EmptyState
          icon={failed ? 'cloud-off-outline' : 'gift-outline'}
          title={failed ? 'Could not load your rewards' : 'Loading...'}
          note={failed ? 'Please check your internet and try again.' : undefined}
          actionLabel={failed ? 'Retry' : undefined}
          onAction={load}
        />
      </SafeAreaView>
    );
  }

  const { redeem } = data;
  const earnedBadges = data.badges.filter(b => b.earned).length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={pull.control}
      >
        <Text style={styles.title}>Rewards</Text>

        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Icon name="gift" size={34} color={ORANGE} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.heroSmall}>Your points</Text>
            <Text style={styles.heroPoints} accessibilityLabel="Your points">{fmt(data.balance)}</Text>
            <Text style={styles.heroSmall}>
              Worth Rs {data.rupees} · {data.pointsPerRupee} points = Rs 1
            </Text>
          </View>
        </View>

        <Card>
          <CardTitle icon="wallet" iconColor={PURPLE}>Add points to your wallet</CardTitle>
          <Text style={styles.body}>
            Turn points into wallet money and use it as a discount when you book an appointment.
          </Text>
          <Text style={[styles.body, styles.gap]}>
            {redeem.canRedeem
              ? `You can add Rs ${redeem.rupees} to your wallet now.`
              : `You can add points to your wallet from ${fmt(redeem.unit)} points. ${fmt(redeem.pointsToGo)} more to go!`}
          </Text>
          <View style={styles.gap}>
            <ProgressBar percent={Math.round((data.balance / redeem.unit) * 100)} color={PURPLE} />
          </View>
          <Pressable
            style={[styles.redeem, (!redeem.canRedeem || busy) && styles.redeemOff]}
            disabled={!redeem.canRedeem || busy}
            onPress={onRedeem}
            accessibilityRole="button"
            accessibilityLabel="Add to my wallet"
          >
            <Text style={styles.redeemText}>
              Add Rs {redeem.canRedeem ? redeem.rupees : redeem.unitRupees} to my wallet
            </Text>
          </Pressable>
        </Card>

        <Card>
          <CardTitle icon="star-four-points" iconColor="#F5A623">How to earn points</CardTitle>
          {data.earn.map(rule => (
            <View key={rule.id} style={styles.earnRow}>
              <View style={styles.earnIcon}>
                <Icon name={EARN_ICONS[rule.id]} size={20} color={EARN_COLORS[rule.id]} />
              </View>
              <Text style={[styles.earnLabel, styles.flex]}>{rule.label}</Text>
              <Text style={styles.earnPoints}>+{rule.points}</Text>
            </View>
          ))}
        </Card>

        <Card>
          <CardTitle icon="bullseye-arrow" iconColor={ORANGE}>This week's challenges</CardTitle>
          {data.challenges.map(c => (
            <View key={c.id} style={styles.challenge}>
              <Text style={styles.challengeTitle}>{c.title}</Text>
              <ProgressBar percent={Math.round((c.progress / c.target) * 100)} color={ORANGE} />
              <Text style={styles.muted}>
                {c.done ? 'Done' : `${c.progress} of ${c.target}`} · +{c.bonus} points
              </Text>
            </View>
          ))}
        </Card>

        <Card>
          <CardTitle icon="medal" iconColor="#F5A623">
            Badges ({earnedBadges} of {data.badges.length})
          </CardTitle>
          <View style={styles.badges}>
            {data.badges.map(badge => (
              <BadgeCircle key={badge.id} badge={badge} />
            ))}
          </View>
        </Card>

        <View style={styles.tabs}>
          <Chip label="Points history" selected={tab === 'points'} onPress={() => setTab('points')} />
          <Chip label="Added to wallet" selected={tab === 'wallet'} onPress={() => setTab('wallet')} />
        </View>
        <Card>
          {tab === 'points' ? (
            data.history.length === 0 ? (
              <Text style={styles.body}>No points yet. Drink water, walk and finish your day to earn them.</Text>
            ) : (
              data.history.map(row => (
                <View key={row.id} style={styles.historyRow}>
                  <View style={styles.flex}>
                    <Text style={styles.historyLabel}>{row.label}</Text>
                    <Text style={styles.muted}>{shortDay(row.at.slice(0, 10))}</Text>
                  </View>
                  <Text style={[styles.historyPoints, row.points < 0 && styles.historyOut]}>
                    {row.points > 0 ? '+' : ''}{row.points}
                  </Text>
                </View>
              ))
            )
          ) : data.wallet.length === 0 ? (
            <Text style={styles.body}>Nothing added to your wallet yet.</Text>
          ) : (
            data.wallet.map(row => (
              <View key={row.id} style={styles.historyRow}>
                <View style={styles.flex}>
                  <Text style={styles.historyLabel}>Rs {row.rupees} added</Text>
                  <Text style={styles.muted}>{shortDay(row.at.slice(0, 10))}</Text>
                </View>
                <Text style={[styles.historyPoints, styles.historyOut]}>-{row.points} points</Text>
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: WELLNESS_BG },
  flex: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 120 },
  title: { fontFamily: 'Poppins-Bold', fontSize: 28, color: colors.text, marginBottom: 14 },
  hero: { flexDirection: 'row', alignItems: 'center', backgroundColor: PURPLE, borderRadius: 22, padding: 16, marginBottom: 14 },
  heroIcon: { width: 70, height: 70, borderRadius: 18, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  heroSmall: { fontFamily: 'Poppins-Regular', fontSize: 13.5, color: '#EADCFF' },
  heroPoints: { fontFamily: 'Poppins-Bold', fontSize: 34, color: '#fff' },
  body: { fontFamily: 'Poppins-Regular', fontSize: 14, color: colors.muted },
  gap: { marginTop: 10 },
  muted: { fontFamily: 'Poppins-Regular', fontSize: 12.5, color: colors.muted },
  redeem: { height: 48, borderRadius: 24, backgroundColor: PURPLE, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  redeemOff: { opacity: 0.45 },
  redeemText: { fontFamily: 'Poppins-SemiBold', fontSize: 15, color: '#fff' },
  earnRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  earnIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#F1F6F2', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  earnLabel: { fontFamily: 'Poppins-Regular', fontSize: 15, color: colors.text },
  earnPoints: { fontFamily: 'Poppins-SemiBold', fontSize: 15, color: PURPLE },
  challenge: { backgroundColor: '#FFF1E4', borderRadius: 14, padding: 12, marginBottom: 10 },
  challengeTitle: { fontFamily: 'Poppins-SemiBold', fontSize: 14.5, color: colors.text, marginBottom: 8 },
  badges: { flexDirection: 'row', flexWrap: 'wrap' },
  tabs: { flexDirection: 'row', marginBottom: 10 },
  historyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  historyLabel: { fontFamily: 'Poppins-Regular', fontSize: 15, color: colors.text },
  historyPoints: { fontFamily: 'Poppins-SemiBold', fontSize: 16, color: colors.primary },
  historyOut: { color: PURPLE },
});
