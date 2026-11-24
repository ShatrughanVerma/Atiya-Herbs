import React, { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors } from '../../theme';
import { useWellness } from '../context/WellnessContext';
import { clock, distanceKm, kcalOf, pace } from '../utils/stepMath';
import { Card, CardTitle, ProgressBar } from './parts';

const ORANGE = '#F57C00';
const fmt = n => Math.round(n).toLocaleString('en-IN');

// One small number with its caption
function Stat({ icon, value, label }) {
  return (
    <View style={styles.stat}>
      <Icon name={icon} size={20} color={ORANGE} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// Today's steps, live. Shows a button to turn the step counter on when it is off.
export function StepsCard() {
  const { today, stepStatus, steps, enableSteps, recentSteps } = useWellness();
  const perStep = today?.steps?.perStep;
  const goal = today?.steps?.goal ?? 6000;
  const percent = Math.min(100, Math.round((steps / goal) * 100));

  return (
    <Card>
      <CardTitle icon="shoe-print" iconColor={ORANGE}>Steps</CardTitle>
      {stepStatus === 'unsupported' ? (
        <Text style={styles.body}>
          This phone has no step counter, so steps cannot be shown.
        </Text>
      ) : stepStatus === 'off' || stepStatus === 'denied' ? (
        <>
          <Text style={styles.body}>
            {stepStatus === 'denied'
              ? 'Step counting needs the "Physical activity" permission. You can allow it in the phone settings.'
              : "See your steps, distance and calories live. We only read your phone's step counter."}
          </Text>
          <Pressable
            style={styles.primary}
            onPress={stepStatus === 'denied' ? () => Linking.openSettings() : enableSteps}
            accessibilityRole="button"
            accessibilityLabel={stepStatus === 'denied' ? 'Open settings' : 'Turn on step counting'}
          >
            <Text style={styles.primaryText}>
              {stepStatus === 'denied' ? 'Open settings' : 'Turn on step counting'}
            </Text>
          </Pressable>
        </>
      ) : (
        <>
          <View style={styles.countRow}>
            <Text style={styles.count} accessibilityLabel="Steps today">
              {fmt(steps)}
            </Text>
            <Text style={styles.of}>of {fmt(goal)} steps</Text>
          </View>
          <ProgressBar percent={percent} color={ORANGE} height={10} />
          <View style={styles.stats}>
            <Stat icon="map-marker-distance" value={`${distanceKm(steps, perStep)} km`} label="Distance" />
            <Stat icon="fire" value={`${kcalOf(steps, perStep)}`} label="Calories" />
            <Stat icon="target" value={`${percent}%`} label="Of goal" />
          </View>
          {recentSteps.available && (
            <View style={styles.recent}>
              <View style={styles.recentHead}>
                <Text style={styles.recentLabel}>Last 10 minutes</Text>
                <Text style={styles.recentValue} accessibilityLabel="Steps in the last 10 minutes">
                  {fmt(recentSteps.steps)} steps
                </Text>
              </View>
              <View style={styles.recentBars}>
                {recentSteps.perMinute.map((value, i) => (
                  <View
                    key={i}
                    style={[
                      styles.recentBar,
                      { height: Math.max(3, Math.round((value / Math.max(1, ...recentSteps.perMinute)) * 26)) },
                    ]}
                  />
                ))}
              </View>
            </View>
          )}
          {stepStatus === 'checking' && <Text style={styles.small}>Starting the step counter...</Text>}
        </>
      )}
    </Card>
  );
}

// Walk mode: start a walk, watch it live, stop it to save it
export function WalkCard() {
  const { today, stepStatus, steps, walk, startWalk, stopWalk, lastWalk } = useWellness();
  const [now, setNow] = useState(Date.now());

  // one tick a second while a walk is running
  useEffect(() => {
    if (!walk) {
      return undefined;
    }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [walk]);

  if (stepStatus !== 'on') {
    return null; // a walk needs the step counter
  }

  const perStep = today?.steps?.perStep;
  const seconds = walk ? Math.max(0, Math.round((now - walk.startedAt) / 1000)) : 0;
  const walked = walk ? Math.max(0, steps - walk.startSteps) : 0;
  const km = distanceKm(walked, perStep);

  const onStop = async () => {
    try {
      const saved = await stopWalk();
      Alert.alert(
        saved ? 'Walk saved' : 'Walk too short',
        saved
          ? `${fmt(saved.steps)} steps, ${saved.distanceKm} km, ${saved.kcal} kcal in ${clock(saved.durationSec)}.`
          : 'Walk for at least 10 seconds to save it.',
      );
    } catch {
      Alert.alert('Could not save the walk', 'Please check your internet and try again.');
    }
  };

  return (
    <Card>
      <CardTitle icon="walk" iconColor={ORANGE}>Walk mode</CardTitle>
      {walk ? (
        <>
          <Text style={styles.timer} accessibilityLabel="Walk time">{clock(seconds)}</Text>
          <View style={styles.stats}>
            <Stat icon="shoe-print" value={fmt(walked)} label="Steps" />
            <Stat icon="map-marker-distance" value={`${km} km`} label="Distance" />
            <Stat icon="fire" value={`${kcalOf(walked, perStep)}`} label="Calories" />
            <Stat icon="speedometer" value={pace(seconds, km)} label="Min / km" />
          </View>
          <Pressable style={styles.stop} onPress={onStop} accessibilityRole="button" accessibilityLabel="Stop walk">
            <Icon name="stop" size={20} color="#fff" />
            <Text style={styles.primaryText}>Stop walk</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.body}>
            {lastWalk
              ? `Last walk: ${fmt(lastWalk.steps)} steps, ${lastWalk.distanceKm} km in ${clock(lastWalk.durationSec)}.`
              : 'Track a walk live: time, steps, distance and pace.'}
          </Text>
          <Pressable style={styles.primary} onPress={startWalk} accessibilityRole="button" accessibilityLabel="Start walk">
            <Icon name="play" size={20} color="#fff" />
            <Text style={styles.primaryText}>Start walk</Text>
          </Pressable>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { fontFamily: 'Poppins-Regular', fontSize: 14, color: colors.muted },
  small: { fontFamily: 'Poppins-Regular', fontSize: 12, color: colors.muted, marginTop: 8 },
  countRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 10 },
  count: { fontFamily: 'Poppins-Bold', fontSize: 34, color: colors.text },
  of: { fontFamily: 'Poppins-Regular', fontSize: 14, color: colors.muted, marginLeft: 10 },
  stats: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  recent: { marginTop: 14, backgroundColor: '#FFF6EC', borderRadius: 12, padding: 10 },
  recentHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  recentLabel: { fontFamily: 'Poppins-Regular', fontSize: 13, color: colors.muted },
  recentValue: { fontFamily: 'Poppins-SemiBold', fontSize: 14, color: ORANGE },
  recentBars: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 28, marginTop: 6 },
  recentBar: { width: '8%', borderRadius: 3, backgroundColor: '#F8B26A' },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontFamily: 'Poppins-SemiBold', fontSize: 15, color: colors.text, marginTop: 2 },
  statLabel: { fontFamily: 'Poppins-Regular', fontSize: 11.5, color: colors.muted },
  timer: { fontFamily: 'Poppins-Bold', fontSize: 40, color: colors.text, textAlign: 'center' },
  primary: {
    flexDirection: 'row',
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  stop: {
    flexDirection: 'row',
    height: 46,
    borderRadius: 23,
    backgroundColor: '#D32F2F',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  primaryText: { fontFamily: 'Poppins-SemiBold', fontSize: 15, color: '#fff', marginLeft: 6 },
});
