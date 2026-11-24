import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import EmptyState from '../../components/shop/EmptyState';
import { colors } from '../../theme';
import useRefresh from '../../utils/useRefresh';
import {
  BLUE,
  BLUE_LIGHT,
  Card,
  CardTitle,
  Chip,
  MoodPicker,
  ProgressBar,
  WELLNESS_BG,
  moodEmoji,
} from '../components/parts';
import { useWellness } from '../context/WellnessContext';
import { fetchHistory, fetchWalks } from '../services/wellnessApi';
import { dayLabel } from '../utils/dates';
import { clock } from '../utils/stepMath';

const RANGES = [7, 30, 90];

export default function HealthScreen() {
  const { today, status, refresh, addWater, setMood } = useWellness();
  const [days, setDays] = useState(30);
  const [history, setHistory] = useState(null); // null = loading
  const [historyError, setHistoryError] = useState(false);
  const [walks, setWalks] = useState([]);

  const loadHistory = useCallback(async () => {
    try {
      const [res, walkRes] = await Promise.all([fetchHistory(days), fetchWalks(days)]);
      setHistory(res.items);
      setWalks(walkRes.items);
      setHistoryError(false);
    } catch {
      setHistoryError(true);
    }
  }, [days]);

  useEffect(() => {
    setHistory(null);
    loadHistory();
  }, [loadHistory]);

  // after a tap on a glass or a mood the history of today changes too: load it again when the day's data changes
  const signature = today ? `${today.water.ml}|${today.mood}` : '';
  useEffect(() => {
    if (signature) {
      loadHistory();
    }
  }, [signature, loadHistory]);

  const pull = useRefresh(() => Promise.all([refresh(), loadHistory()]));

  if (!today) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Text style={styles.title}>Health</Text>
        <EmptyState
          icon={status === 'error' ? 'cloud-off-outline' : 'heart-pulse'}
          title={status === 'error' ? 'Could not load your health' : 'Loading...'}
          note={status === 'error' ? 'Please check your internet and try again.' : undefined}
          actionLabel={status === 'error' ? 'Retry' : undefined}
          onAction={refresh}
        />
      </SafeAreaView>
    );
  }

  const glass = today.settings.glassMl;
  const { glasses, goalGlasses } = today.water;
  const shown = Math.min(30, Math.max(goalGlasses, glasses + 1));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={pull.control}
      >
        <Text style={styles.title}>Health</Text>

        <Card>
          <CardTitle icon="water" iconColor={BLUE}>Water</CardTitle>
          <View style={styles.waterLine}>
            <Text style={styles.waterBig}>
              {glasses} of {goalGlasses} glasses
            </Text>
            <Text style={styles.muted}>
              {today.water.ml.toLocaleString('en-IN')} / {today.water.goalMl.toLocaleString('en-IN')} ml
            </Text>
          </View>
          <View style={styles.glasses}>
            {Array.from({ length: shown }, (_, i) => {
              const filled = i < glasses;
              // only the next empty glass and the last filled one react: one glass at a time
              const next = i === glasses;
              const last = i === glasses - 1;
              return (
                <Pressable
                  key={i}
                  style={[styles.glass, filled && styles.glassOn]}
                  disabled={!next && !last}
                  onPress={() => addWater(next ? glass : -glass)}
                  accessibilityRole="button"
                  accessibilityLabel={filled ? `Glass ${i + 1} drunk` : `Glass ${i + 1}`}
                >
                  <Icon name="water" size={26} color={filled ? BLUE : '#B8C2BB'} />
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.hint}>
            Tap a glass each time you drink one ({glass} ml). Tap the last full glass to take it back.
          </Text>
        </Card>

        <Card>
          <CardTitle icon="pill">Today's medicines</CardTitle>
          <Text style={styles.body}>No medicines are due today.</Text>
        </Card>

        <Card>
          <CardTitle icon="heart" iconColor="#E53935">How are you feeling today?</CardTitle>
          <MoodPicker mood={today.mood} onChange={setMood} />
        </Card>

        <Text style={styles.section}>Walks</Text>
        {walks.length === 0 ? (
          <Card>
            <Text style={styles.body}>No walks yet. Start a walk from the Home tab.</Text>
          </Card>
        ) : (
          walks.slice(0, 5).map(w => (
            <Card key={w.id}>
              <View style={styles.dayHead}>
                <Text style={styles.dayTitle}>{dayLabel(w.startedAt.slice(0, 10))}</Text>
                <Text style={styles.walkTime}>{clock(w.durationSec)}</Text>
              </View>
              <Text style={styles.body}>
                {w.steps.toLocaleString('en-IN')} steps · {w.distanceKm} km · {w.kcal} kcal
              </Text>
            </Card>
          ))
        )}

        <Text style={styles.section}>History</Text>
        <View style={styles.chips}>
          {RANGES.map(r => (
            <Chip key={r} label={`${r} days`} selected={days === r} onPress={() => setDays(r)} />
          ))}
        </View>

        {historyError && history === null ? (
          <Card>
            <Text style={styles.body}>Could not load your history. Pull down to try again.</Text>
          </Card>
        ) : history === null ? (
          <Text style={styles.muted}>Loading...</Text>
        ) : history.length === 0 ? (
          <Card>
            <Text style={styles.body}>
              Nothing here yet. Your days will show up as you add water and your mood.
            </Text>
          </Card>
        ) : (
          history.map(item => (
            <Card key={item.day}>
              <View style={styles.dayHead}>
                <Text style={styles.dayTitle}>{dayLabel(item.day)}</Text>
                <View style={styles.dayRight}>
                  <Text style={styles.dayMood}>{moodEmoji(item.mood)}</Text>
                  {item.complete && (
                    <View style={styles.complete}>
                      <Text style={styles.completeText}>✓ Complete</Text>
                    </View>
                  )}
                </View>
              </View>
              <View style={styles.dayBars}>
                <View style={styles.flex}>
                  <View style={styles.dayBarLabel}>
                    <Icon name="water" size={16} color={BLUE} />
                    <Text style={styles.dayBarText}>
                      {item.glasses}/{item.goalGlasses}
                    </Text>
                  </View>
                  <ProgressBar
                    percent={Math.round((item.waterMl / item.goalMl) * 100)}
                    color={BLUE}
                  />
                </View>
                <View style={[styles.flex, styles.dayBarGap]}>
                  <View style={styles.dayBarLabel}>
                    <Icon name="shoe-print" size={16} color="#F57C00" />
                    <Text style={styles.dayBarText}>{item.steps.toLocaleString('en-IN')}</Text>
                  </View>
                  <ProgressBar percent={Math.round((item.steps / today.steps.goal) * 100)} color="#F57C00" />
                </View>
              </View>
            </Card>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: WELLNESS_BG },
  flex: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 120 },
  title: { fontFamily: 'Poppins-Bold', fontSize: 28, color: colors.text, marginBottom: 14, paddingHorizontal: 0 },
  waterLine: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 12 },
  waterBig: { fontFamily: 'Poppins-Bold', fontSize: 20, color: colors.text, marginRight: 10 },
  muted: { fontFamily: 'Poppins-Regular', fontSize: 13, color: colors.muted },
  glasses: { flexDirection: 'row', flexWrap: 'wrap' },
  glass: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#F1F6F2',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  glassOn: { backgroundColor: BLUE_LIGHT, borderColor: BLUE },
  hint: { fontFamily: 'Poppins-Regular', fontSize: 12.5, color: colors.muted, marginTop: 4 },
  body: { fontFamily: 'Poppins-Regular', fontSize: 15, color: colors.muted },
  section: { fontFamily: 'Poppins-Bold', fontSize: 22, color: colors.text, marginTop: 6, marginBottom: 8 },
  chips: { flexDirection: 'row', marginBottom: 12 },
  dayHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  dayTitle: { fontFamily: 'Poppins-SemiBold', fontSize: 16, color: colors.text },
  dayRight: { flexDirection: 'row', alignItems: 'center' },
  dayMood: { fontSize: 22, marginRight: 8 },
  complete: { backgroundColor: '#E7F8EE', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 },
  completeText: { fontFamily: 'Poppins-Medium', fontSize: 12, color: colors.primary },
  dayBars: { flexDirection: 'row' },
  dayBarGap: { marginLeft: 16 },
  dayBarLabel: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  dayBarText: { fontFamily: 'Poppins-Medium', fontSize: 13, color: colors.text, marginLeft: 6 },
  walkTime: { fontFamily: 'Poppins-SemiBold', fontSize: 15, color: colors.primary },
});
