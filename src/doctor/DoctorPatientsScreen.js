import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, FlatList, Linking, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Avatar from '../calling/Avatar';
import EmptyState from '../components/shop/EmptyState';
import {fetchDoctorPatients} from '../services/doctorApi';
import {formatDay} from '../utils/consult';
import {colors, spacing} from '../theme';

// The people who asked this doctor for an appointment (cancelled requests are left out)
export default function DoctorPatientsScreen({navigation}) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [state, setState] = useState('loading');

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 350);
    return () => clearTimeout(timer);
  }, [text]);

  const load = useCallback(async () => {
    setState(prev => (prev === 'ready' ? prev : 'loading'));
    try {
      setItems((await fetchDoctorPatients({q: query})).items);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [query]);

  useEffect(() => {
    load();
    return navigation.addListener('focus', load);
  }, [load, navigation]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Text style={styles.title}>Patients</Text>
      <View style={styles.searchWrap}>
        <Icon name="magnify" size={22} color={colors.muted} />
        <TextInput style={styles.search} value={text} onChangeText={setText} placeholder="Search name or mobile" placeholderTextColor="#9AA3AF" accessibilityLabel="Search patients" />
      </View>
      {state === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : state === 'error' ? (
        <EmptyState icon="cloud-off-outline" title="Could not load patients" note="Please check your internet and try again." actionLabel="Retry" onAction={load} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={p => `${p.mobile}|${p.name}`}
          contentContainerStyle={styles.list}
          refreshing={false}
          onRefresh={load}
          ListEmptyComponent={<EmptyState icon="account-multiple-outline" title="No patients yet" note="People who book you appear here." />}
          renderItem={({item: p}) => (
            <View style={styles.row}>
              <Avatar name={p.name} size={48} />
              <View style={styles.body}>
                <Text style={styles.name} numberOfLines={1}>
                  {p.name}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {p.lastVisit ? `Last: ${formatDay(p.lastVisit)}` : 'Waiting for a time'}
                  {p.visits > 0 ? ` · ${p.visits} visit${p.visits > 1 ? 's' : ''}` : ''}
                </Text>
                {!!p.lastConcern && (
                  <Text style={styles.concern} numberOfLines={1}>
                    {p.lastConcern}
                  </Text>
                )}
              </View>
              <Pressable style={styles.call} onPress={() => Linking.openURL(`tel:${p.mobile}`)} accessibilityRole="button" accessibilityLabel={`Call ${p.name}`}>
                <Icon name="phone-outline" size={22} color={colors.primaryDark} />
              </Pressable>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.card},
  title: {fontSize: 26, fontWeight: '800', color: colors.text, paddingHorizontal: spacing.md, paddingTop: 12},
  searchWrap: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', margin: spacing.md, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.border},
  search: {flex: 1, minHeight: 48, marginLeft: 8, color: colors.text},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  list: {padding: spacing.md, paddingTop: 0, flexGrow: 1},
  row: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.border},
  body: {flex: 1, marginHorizontal: 12},
  name: {fontWeight: '800', fontSize: 16, color: colors.text},
  meta: {color: colors.muted, marginTop: 2, fontSize: 13},
  concern: {color: colors.primary, marginTop: 2, fontSize: 13},
  call: {width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center'},
});
