import React, {useEffect, useState} from 'react';
import {ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {fetchDoctorAppointments} from '../services/doctorApi';
import {formatDay, formatTime, typeLabel} from '../utils/consult';
import {colors, spacing} from '../theme';

// "Which visit is this video of?" - the confirmed and completed appointments, newest first
export default function AppointmentPickerSheet({onClose, onPick}) {
  const [items, setItems] = useState([]);
  const [state, setState] = useState('loading');

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchDoctorAppointments({status: 'booked', pageSize: 50}), fetchDoctorAppointments({status: 'completed', pageSize: 50})])
      .then(([booked, completed]) => {
        if (cancelled) {
          return;
        }
        const all = [...booked.items, ...completed.items].filter(a => a.startsAt);
        all.sort((a, b) => b.startsAt.localeCompare(a.startsAt));
        setItems(all);
        setState('ready');
      })
      .catch(() => !cancelled && setState('error'));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Which visit is the video of?</Text>
          <Text style={styles.muted}>Choose a confirmed or completed appointment.</Text>

          {state === 'loading' ? (
            <ActivityIndicator color={colors.primary} style={styles.loading} />
          ) : state === 'error' ? (
            <Text style={styles.error}>Could not load your appointments. Please check your internet and try again.</Text>
          ) : items.length === 0 ? (
            <View style={styles.empty}>
              <Icon name="calendar-blank-outline" size={40} color={colors.muted} />
              <Text style={styles.emptyTitle}>No confirmed appointment yet</Text>
              <Text style={styles.muted}>Confirm a request in the Appointment tab first. Then you can add the video of that visit.</Text>
            </View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={a => a.id}
              style={styles.list}
              renderItem={({item: a}) => (
                <Pressable style={styles.row} onPress={() => onPick(a)} accessibilityRole="button" accessibilityLabel={`Choose ${a.patientName}`}>
                  <View style={styles.rowText}>
                    <Text style={styles.name} numberOfLines={1}>
                      {a.patientName}
                    </Text>
                    <Text style={styles.muted} numberOfLines={1}>
                      {formatDay(a.startsAt)}, {formatTime(a.startsAt)} · {typeLabel(a.type)}
                    </Text>
                  </View>
                  <View style={[styles.badge, a.status === 'completed' && styles.badgeDone]}>
                    <Text style={styles.badgeText}>{a.status === 'completed' ? 'Completed' : 'Confirmed'}</Text>
                  </View>
                  <Icon name="chevron-right" size={22} color={colors.muted} />
                </Pressable>
              )}
            />
          )}

          <Pressable style={styles.close} onPress={onClose} accessibilityRole="button">
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end'},
  sheet: {backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.md, maxHeight: '80%'},
  title: {fontSize: 20, fontWeight: '800', color: colors.text},
  muted: {color: colors.muted, marginTop: 2, fontSize: 13},
  loading: {marginVertical: 24},
  error: {color: colors.danger, marginVertical: 16},
  empty: {alignItems: 'center', paddingVertical: 24},
  emptyTitle: {fontWeight: '800', fontSize: 16, color: colors.text, marginTop: 8, marginBottom: 4},
  list: {marginTop: 10, flexGrow: 0},
  row: {flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border},
  rowText: {flex: 1, marginRight: 8},
  name: {fontWeight: '800', fontSize: 16, color: colors.text},
  badge: {backgroundColor: colors.primaryLight, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3, marginRight: 4},
  badgeDone: {backgroundColor: '#E3EEFB'},
  badgeText: {color: colors.primary, fontWeight: '700', fontSize: 11},
  close: {height: 48, borderRadius: 24, borderWidth: 1.5, borderColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center', marginTop: 14},
  closeText: {color: colors.primaryDark, fontWeight: '700'},
});
