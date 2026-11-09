import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import EmptyState from '../components/shop/EmptyState';
import ScreenHeader from '../components/shop/ScreenHeader';
import {fetchDoctorSchedule, saveDoctorSchedule} from '../services/doctorApi';
import {DAY_NAMES, DAY_ORDER, SLOT_MINUTES, daysToTimings, timeOptions, timingsToDays, to12Hour, validateDays} from '../utils/doctor';
import {colors, spacing} from '../theme';

const NEW_RANGE = {startTime: '10:00', endTime: '13:00', slotMinutes: 20};
const TIMES = timeOptions();

// A list of times to choose from (no native time picker needed)
function TimePicker({title, value, onClose, onPick}) {
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{title}</Text>
          <ScrollView style={styles.timesBox}>
            <View style={styles.wrap}>
              {TIMES.map(time => (
                <Pressable key={time} style={[styles.timeChip, time === value && styles.on]} onPress={() => onPick(time)} accessibilityRole="button">
                  <Text style={[styles.timeText, time === value && styles.onText]}>{to12Hour(time)}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

// The doctor's weekly timetable. Patients can only ask for times inside it. Already confirmed appointments stay.
export default function DaysTimesScreen({navigation}) {
  const [days, setDays] = useState(null); // 7 lists of {startTime, endTime, slotMinutes}, 0 = Sunday
  const [state, setState] = useState('loading');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [picker, setPicker] = useState(null); // {weekday, index, field}

  const load = () => {
    setState('loading');
    fetchDoctorSchedule()
      .then(res => {
        setDays(timingsToDays(res.timings));
        setState('ready');
      })
      .catch(() => setState('error'));
  };
  useEffect(load, []);

  const change = update => {
    setDays(prev => update(prev.map(ranges => ranges.map(r => ({...r})))));
    setDirty(true);
  };
  const toggleDay = (weekday, on) =>
    change(next => {
      next[weekday] = on ? [{...NEW_RANGE}] : [];
      return next;
    });
  const addRange = weekday =>
    change(next => {
      next[weekday].push({...NEW_RANGE});
      return next;
    });
  const removeRange = (weekday, index) =>
    change(next => {
      next[weekday].splice(index, 1);
      return next;
    });
  const setField = (weekday, index, field, value) =>
    change(next => {
      next[weekday][index][field] = value;
      return next;
    });

  const save = async () => {
    const problem = validateDays(days);
    if (problem) {
      Alert.alert('Days & times', problem);
      return;
    }
    setSaving(true);
    try {
      const res = await saveDoctorSchedule(daysToTimings(days));
      setDays(timingsToDays(res.timings));
      setDirty(false);
      Alert.alert('Days & times', 'Your timetable is saved. Patients can now book these times.');
    } catch (error) {
      Alert.alert('Days & times', error.message);
    } finally {
      setSaving(false);
    }
  };

  if (state !== 'ready') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <ScreenHeader title="Days & times" navigation={navigation} />
        {state === 'loading' ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : (
          <EmptyState icon="cloud-off-outline" title="Could not load your timetable" note="Please check your internet and try again." actionLabel="Retry" onAction={load} />
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader title="Days & times" navigation={navigation} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>Choose the days you see patients and the hours. Times are in Indian time.</Text>
        {DAY_ORDER.map(weekday => {
          const ranges = days[weekday];
          const on = ranges.length > 0;
          return (
            <View key={weekday} style={styles.card}>
              <View style={styles.dayHead}>
                <Text style={styles.dayName}>{DAY_NAMES[weekday]}</Text>
                <Text style={styles.dayState}>{on ? '' : 'Off'}</Text>
                <Switch value={on} onValueChange={value => toggleDay(weekday, value)} trackColor={{true: colors.primary}} accessibilityLabel={`${DAY_NAMES[weekday]} on or off`} />
              </View>
              {ranges.map((r, index) => (
                <View key={index} style={styles.range}>
                  <View style={styles.rangeRow}>
                    <Pressable style={styles.timeBtn} onPress={() => setPicker({weekday, index, field: 'startTime'})} accessibilityRole="button" accessibilityLabel="Start time">
                      <Text style={styles.timeBtnText}>{to12Hour(r.startTime)}</Text>
                    </Pressable>
                    <Text style={styles.to}>to</Text>
                    <Pressable style={styles.timeBtn} onPress={() => setPicker({weekday, index, field: 'endTime'})} accessibilityRole="button" accessibilityLabel="End time">
                      <Text style={styles.timeBtnText}>{to12Hour(r.endTime)}</Text>
                    </Pressable>
                    <Pressable style={styles.remove} onPress={() => removeRange(weekday, index)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove this time range">
                      <Icon name="close-circle-outline" size={24} color={colors.danger} />
                    </Pressable>
                  </View>
                  <View style={styles.minutes}>
                    <Text style={styles.minutesLabel}>Each visit</Text>
                    {SLOT_MINUTES.map(m => (
                      <Pressable key={m} style={[styles.minChip, r.slotMinutes === m && styles.on]} onPress={() => setField(weekday, index, 'slotMinutes', m)} accessibilityRole="button">
                        <Text style={[styles.minText, r.slotMinutes === m && styles.onText]}>{m} min</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
              {on && (
                <Pressable style={styles.add} onPress={() => addRange(weekday)} accessibilityRole="button">
                  <Icon name="plus" size={18} color={colors.primary} />
                  <Text style={styles.addText}>Add time range</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={[styles.save, (!dirty || saving) && styles.disabled]} disabled={!dirty || saving} onPress={save} accessibilityRole="button">
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save timetable</Text>}
        </Pressable>
      </View>

      {!!picker && (
        <TimePicker
          title={picker.field === 'startTime' ? 'Start time' : 'End time'}
          value={days[picker.weekday][picker.index][picker.field]}
          onClose={() => setPicker(null)}
          onPick={time => {
            setField(picker.weekday, picker.index, picker.field, time);
            setPicker(null);
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.card},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  content: {padding: spacing.md, paddingBottom: spacing.lg},
  intro: {color: colors.muted, marginBottom: 12, lineHeight: 20},
  card: {backgroundColor: '#fff', borderRadius: 18, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.border},
  dayHead: {flexDirection: 'row', alignItems: 'center'},
  dayName: {flex: 1, fontWeight: '800', fontSize: 17, color: colors.text},
  dayState: {color: colors.muted, marginRight: 8},
  range: {marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border},
  rangeRow: {flexDirection: 'row', alignItems: 'center'},
  timeBtn: {flex: 1, height: 44, borderRadius: 12, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center'},
  timeBtnText: {fontWeight: '700', color: colors.text},
  to: {marginHorizontal: 10, color: colors.muted},
  remove: {marginLeft: 10},
  minutes: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 10},
  minutesLabel: {color: colors.muted, marginRight: 8, fontSize: 13},
  minChip: {paddingHorizontal: 10, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginRight: 6, marginVertical: 3},
  minText: {fontSize: 12, color: colors.text},
  add: {flexDirection: 'row', alignItems: 'center', marginTop: 12},
  addText: {color: colors.primary, fontWeight: '700', marginLeft: 4},
  on: {backgroundColor: colors.primaryDark, borderColor: colors.primaryDark},
  onText: {color: '#fff', fontWeight: '700'},
  footer: {padding: spacing.md, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.border},
  save: {backgroundColor: colors.primaryDark, borderRadius: 28, height: 54, alignItems: 'center', justifyContent: 'center'},
  saveText: {color: '#fff', fontWeight: '800', fontSize: 17},
  disabled: {opacity: 0.5},
  backdrop: {flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: spacing.md},
  sheet: {backgroundColor: '#fff', borderRadius: 20, padding: spacing.md, maxHeight: '75%'},
  sheetTitle: {fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 10},
  timesBox: {flexGrow: 0},
  wrap: {flexDirection: 'row', flexWrap: 'wrap'},
  timeChip: {paddingHorizontal: 12, height: 38, borderRadius: 19, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginRight: 8, marginBottom: 8},
  timeText: {color: colors.text, fontSize: 13},
});
