import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {WEEKDAY_NAMES, monthGrid, monthTitle, toYmd} from '../../utils/consult';
import {colors} from '../../theme';

// A month calendar. Days before `minYmd` or after `maxYmd` are greyed out and cannot be chosen.
export default function MonthCalendar({selected, onSelect, minYmd, maxYmd}) {
  const start = selected || minYmd;
  const [year, setYear] = useState(Number(start.slice(0, 4)));
  const [month, setMonth] = useState(Number(start.slice(5, 7)) - 1);

  const canGoBack = toYmd(year, month, 1) > `${minYmd.slice(0, 8)}01`;
  const canGoForward = toYmd(month === 11 ? year + 1 : year, (month + 1) % 12, 1) <= maxYmd;
  const move = step => {
    const next = month + step;
    setYear(year + Math.floor(next / 12));
    setMonth(((next % 12) + 12) % 12);
  };

  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <Pressable style={[styles.arrow, !canGoBack && styles.arrowOff]} disabled={!canGoBack} onPress={() => move(-1)} accessibilityLabel="Previous month">
          <Icon name="chevron-left" size={24} color={canGoBack ? colors.primaryDark : colors.muted} />
        </Pressable>
        <Text style={styles.title}>{monthTitle(year, month)}</Text>
        <Pressable style={[styles.arrow, !canGoForward && styles.arrowOff]} disabled={!canGoForward} onPress={() => move(1)} accessibilityLabel="Next month">
          <Icon name="chevron-right" size={24} color={canGoForward ? colors.primaryDark : colors.muted} />
        </Pressable>
      </View>
      <View style={styles.row}>
        {WEEKDAY_NAMES.map(name => (
          <Text key={name} style={styles.weekday}>
            {name}
          </Text>
        ))}
      </View>
      {monthGrid(year, month).map((week, i) => (
        <View key={i} style={styles.row}>
          {week.map((day, j) => {
            if (!day) {
              return <View key={j} style={styles.cell} />;
            }
            const ymd = toYmd(year, month, day);
            const disabled = ymd < minYmd || ymd > maxYmd;
            const on = ymd === selected;
            return (
              <Pressable
                key={j}
                style={styles.cell}
                disabled={disabled}
                onPress={() => onSelect(ymd)}
                accessibilityRole="button"
                accessibilityState={{disabled, selected: on}}
                accessibilityLabel={`${day} ${monthTitle(year, month)}`}>
                <View style={[styles.day, ymd === minYmd && styles.today, on && styles.dayOn]}>
                  <Text style={[styles.dayText, disabled && styles.dayOff, on && styles.dayOnText]}>{day}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: 10, backgroundColor: colors.background},
  head: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8},
  arrow: {width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight},
  arrowOff: {opacity: 0.5},
  title: {fontSize: 17, fontWeight: '700', color: colors.text},
  row: {flexDirection: 'row'},
  weekday: {flex: 1, textAlign: 'center', color: colors.muted, fontSize: 12, paddingVertical: 6},
  cell: {flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center'},
  day: {width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center'},
  today: {borderWidth: 1.5, borderColor: colors.primary},
  dayOn: {backgroundColor: colors.primaryDark, borderColor: colors.primaryDark},
  dayText: {color: colors.text, fontSize: 16},
  dayOff: {color: '#C3C8CF'},
  dayOnText: {color: '#fff', fontWeight: '700'},
});
