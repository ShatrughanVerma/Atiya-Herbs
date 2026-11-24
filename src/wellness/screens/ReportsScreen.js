import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import EmptyState from '../../components/shop/EmptyState';
import { colors } from '../../theme';
import useRefresh from '../../utils/useRefresh';
import { BLUE, BLUE_LIGHT, Card, Chip, ProgressBar, WELLNESS_BG, moodEmoji } from '../components/parts';
import { useWellness } from '../context/WellnessContext';
import { fetchReport } from '../services/wellnessApi';

const ORANGE = '#F57C00';
const RANGES = [
  { id: 'daily', label: 'Daily', now: 'Today', unit: 'day' },
  { id: 'weekly', label: 'Weekly', now: 'This week', unit: 'days' },
  { id: 'monthly', label: 'Monthly', now: 'This month', unit: 'days' },
];
const fmt = n => n.toLocaleString('en-IN');
const topMood = moods => {
  const best = Object.entries(moods).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : null;
};

// One small coloured tile of the summary
function Tile({ color, icon, iconColor, title, value, note }) {
  return (
    <View style={[styles.tile, { backgroundColor: color }]}>
      <Icon name={icon} size={20} color={iconColor} />
      <Text style={styles.tileTitle}>{title}</Text>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileNote}>{note}</Text>
    </View>
  );
}

// Daily, weekly and monthly reports: Atiya 360, Reports tab.
export default function ReportsScreen() {
  const { today, refresh } = useWellness();
  const [range, setRange] = useState('weekly');
  const [data, setData] = useState(null); // {range, ...}
  const [failed, setFailed] = useState(false);
  const mode = RANGES.find(r => r.id === range);

  const load = useCallback(async () => {
    try {
      setData(await fetchReport(range));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [range]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  // today's water, steps or mood changed: the report changes too
  const signature = today ? `${today.water.ml}|${today.steps.count}|${today.mood}` : '';
  useEffect(() => {
    if (signature) {
      load();
    }
  }, [signature, load]);

  const pull = useRefresh(() => Promise.all([refresh(), load()]));

  const chips = (
    <View style={styles.chips}>
      {RANGES.map(r => (
        <Chip key={r.id} label={r.label} selected={range === r.id} onPress={() => setRange(r.id)} />
      ))}
    </View>
  );

  if (!data || data.range !== range) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.head}>
          <Text style={styles.title}>Reports</Text>
          {chips}
        </View>
        <EmptyState
          icon={failed ? 'cloud-off-outline' : 'chart-bar'}
          title={failed ? 'Could not load your report' : 'Loading...'}
          note={failed ? 'Please check your internet and try again.' : undefined}
          actionLabel={failed ? 'Retry' : undefined}
          onAction={load}
        />
      </SafeAreaView>
    );
  }

  const { summary } = data;
  const stepsPercent = Math.min(100, Math.round((summary.stepsPerDay / data.goals.steps) * 100));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={pull.control}
      >
        <Text style={styles.title}>Reports</Text>
        {chips}

        <View style={styles.tiles}>
          <Tile color={BLUE_LIGHT} icon="water" iconColor={BLUE} title="Water" value={`${summary.waterPercent}%`} note={`${summary.glassesPerDay} glasses a day`} />
          <Tile color="#FFF1E4" icon="shoe-print" iconColor={ORANGE} title="Steps" value={fmt(summary.stepsPerDay)} note="steps a day" />
        </View>
        <View style={styles.tiles}>
          <Tile color="#E7F8EE" icon="pill" iconColor={colors.primary} title="Medicines" value="—" note="taken on time" />
          <Tile color="#EFE7FD" icon="check-circle" iconColor="#7C3AED" title="Complete days" value={`${summary.completeDays}/${summary.days}`} note={summary.days === 1 ? 'day' : 'days'} />
        </View>

        <Card>
          <Text style={styles.cardTitle}>{mode.now}</Text>
          <View style={styles.line}>
            <Icon name="water" size={18} color={BLUE} />
            <Text style={[styles.lineLabel, styles.flex]}>Water</Text>
            <Text style={styles.lineValue}>{summary.waterPercent}%</Text>
          </View>
          <ProgressBar percent={summary.waterPercent} color={BLUE} />
          <View style={[styles.line, styles.lineGap]}>
            <Icon name="shoe-print" size={18} color={ORANGE} />
            <Text style={[styles.lineLabel, styles.flex]}>Steps</Text>
            <Text style={styles.lineValue}>{stepsPercent}% of goal</Text>
          </View>
          <ProgressBar percent={stepsPercent} color={ORANGE} />
          <View style={[styles.line, styles.lineGap]}>
            <Icon name="pill" size={18} color={colors.primary} />
            <Text style={[styles.lineLabel, styles.flex]}>Medicines</Text>
            <Text style={styles.lineValue}>—</Text>
          </View>
          <ProgressBar percent={0} />
          <Text style={styles.foot}>
            {summary.completeDays} of {summary.days} {summary.days === 1 ? 'day' : 'days'} complete
            {summary.totalSteps > 0 ? ` · ${summary.distanceKm} km walked` : ''}
          </Text>
        </Card>

        <Text style={styles.section}>Before</Text>
        {data.periods.slice(1).map(p => (
          <Card key={p.from}>
            <View style={styles.periodHead}>
              <Text style={styles.cardTitle}>{p.label}</Text>
              {topMood(p.moods) ? <Text style={styles.mood}>{moodEmoji(topMood(p.moods))}</Text> : null}
            </View>
            <View style={styles.line}>
              <Icon name="water" size={18} color={BLUE} />
              <Text style={[styles.lineLabel, styles.flex]}>Water</Text>
              <Text style={styles.lineValue}>{p.waterPercent}%</Text>
            </View>
            <ProgressBar percent={p.waterPercent} color={BLUE} />
            <View style={[styles.line, styles.lineGap]}>
              <Icon name="shoe-print" size={18} color={ORANGE} />
              <Text style={[styles.lineLabel, styles.flex]}>Steps</Text>
              <Text style={styles.lineValue}>{fmt(p.totalSteps)}</Text>
            </View>
            <Text style={styles.foot}>
              {p.completeDays} of {p.days} {p.days === 1 ? 'day' : 'days'} complete
            </Text>
          </Card>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: WELLNESS_BG },
  flex: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 120 },
  head: { padding: 16, paddingBottom: 0 },
  title: { fontFamily: 'Poppins-Bold', fontSize: 28, color: colors.text, marginBottom: 10 },
  chips: { flexDirection: 'row', marginBottom: 12 },
  tiles: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  tile: { width: '48.5%', borderRadius: 18, padding: 14 },
  tileTitle: { fontFamily: 'Poppins-Regular', fontSize: 13.5, color: colors.muted, marginTop: 4 },
  tileValue: { fontFamily: 'Poppins-Bold', fontSize: 26, color: colors.text },
  tileNote: { fontFamily: 'Poppins-Regular', fontSize: 13, color: colors.muted },
  cardTitle: { fontFamily: 'Poppins-SemiBold', fontSize: 16, color: colors.text, marginBottom: 8 },
  line: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  lineGap: { marginTop: 12 },
  lineLabel: { fontFamily: 'Poppins-Regular', fontSize: 15, color: colors.text, marginLeft: 8 },
  lineValue: { fontFamily: 'Poppins-Medium', fontSize: 15, color: colors.muted },
  foot: { fontFamily: 'Poppins-Regular', fontSize: 14, color: colors.muted, marginTop: 10 },
  section: { fontFamily: 'Poppins-Bold', fontSize: 20, color: colors.text, marginTop: 6, marginBottom: 10 },
  periodHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mood: { fontSize: 22 },
});
