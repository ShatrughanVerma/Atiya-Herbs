import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import EmptyState from '../components/shop/EmptyState';
import ScreenHeader from '../components/shop/ScreenHeader';
import {fetchMyVideos} from '../services/doctorApi';
import {formatDay, formatTime} from '../utils/consult';
import {formatBytes, formatDuration} from '../utils/doctor';
import VideoPlayerModal from './VideoPlayerModal';
import {colors, spacing} from '../theme';

const STATUS_TEXT = {uploading: 'Not finished', uploaded: 'Uploaded', failed: 'Failed', archived: 'Archived'};
const STATUS_COLOR = {uploaded: colors.primary, failed: colors.danger, uploading: colors.accent, archived: colors.muted};

const FILTERS = [
  {id: null, label: 'All'},
  {id: 'uploaded', label: 'Uploaded'},
  {id: 'failed', label: 'Failed'},
  {id: 'uploading', label: 'Not finished'},
];

// All the videos this doctor uploaded, each with its video id (V000012), the patient id (P000123) and the visit.
// The search bar is a smart search: a video id, a patient id, a mobile number, a name or a visit number.
// "Play" opens the video in a player inside the app.
export default function MyVideosScreen({navigation}) {
  const [items, setItems] = useState([]);
  const [state, setState] = useState('loading');
  const [playing, setPlaying] = useState(null); // the video being watched
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState(null);

  // search while typing, but wait a moment so every key press does not ask the server
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 350);
    return () => clearTimeout(timer);
  }, [text]);

  const load = useCallback(async () => {
    try {
      setItems(await fetchMyVideos({q: query, status}));
      setState('ready');
    } catch {
      setState('error');
    }
  }, [query, status]);

  useEffect(() => {
    load();
    return navigation.addListener('focus', load);
  }, [load, navigation]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader title="Consultation videos" navigation={navigation} />
      <View style={styles.searchWrap}>
        <Icon name="magnify" size={22} color={colors.muted} />
        <TextInput
          style={styles.search}
          value={text}
          onChangeText={setText}
          placeholder="Search video ID, patient ID, mobile, name"
          placeholderTextColor="#9AA3AF"
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search videos"
        />
        {!!text && (
          <Pressable onPress={() => setText('')} hitSlop={8} accessibilityLabel="Clear search">
            <Icon name="close-circle" size={18} color={colors.muted} />
          </Pressable>
        )}
      </View>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {FILTERS.map(f => (
            <Pressable key={String(f.id)} style={[styles.chip, status === f.id && styles.chipOn]} onPress={() => setStatus(f.id)} accessibilityRole="button">
              <Text style={[styles.chipText, status === f.id && styles.chipTextOn]}>{f.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      {state === 'loading' && items.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : state === 'error' && items.length === 0 ? (
        <EmptyState icon="cloud-off-outline" title="Could not load your videos" note="Please check your internet and try again." actionLabel="Retry" onAction={load} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={v => v.id}
          contentContainerStyle={styles.list}
          refreshing={false}
          onRefresh={load}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            query || status ? (
              <EmptyState icon="magnify" title="No video found" note="Try a video ID like V000001, a patient ID like P000003, a mobile number or a name." />
            ) : (
              <EmptyState icon="video-off-outline" title="No videos yet" note="Videos you upload from the Home screen show up here." />
            )
          }
          renderItem={({item: v}) => (
            <View style={styles.card}>
              <View style={styles.head}>
                <Text style={styles.code}>{v.code}</Text>
                <View style={styles.status}>
                  <Icon name={v.status === 'uploaded' ? 'check-circle' : v.status === 'failed' ? 'alert-circle' : 'progress-clock'} size={16} color={STATUS_COLOR[v.status] ?? colors.muted} />
                  <Text style={[styles.statusText, {color: STATUS_COLOR[v.status] ?? colors.muted}]}>{STATUS_TEXT[v.status] ?? v.status}</Text>
                </View>
              </View>
              <Text style={styles.name}>{v.patientName}</Text>
              <Text style={styles.muted}>
                {[v.patientCode, v.patientMobile].filter(Boolean).join(' · ')}
              </Text>
              <View style={styles.line}>
                <Icon name="clock-outline" size={16} color={colors.primary} />
                <Text style={styles.lineText}>
                  {[v.uploadedAt ? `${formatDay(v.uploadedAt)}, ${formatTime(v.uploadedAt)}` : formatDay(v.createdAt), formatDuration(v.durationSec), formatBytes(v.sizeBytes)].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {v.status === 'failed' && !!v.failedReason && <Text style={styles.error}>{v.failedReason}</Text>}
              {v.status === 'uploaded' && (
                <Pressable style={styles.playBtn} onPress={() => setPlaying(v)} accessibilityRole="button" accessibilityLabel={`Play video ${v.code}`}>
                  <Icon name="play-circle-outline" size={22} color="#fff" />
                  <Text style={styles.playText}>Play</Text>
                </Pressable>
              )}
            </View>
          )}
        />
      )}
      {!!playing && <VideoPlayerModal video={playing} onClose={() => setPlaying(null)} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.card},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  list: {padding: spacing.md, paddingTop: 4, flexGrow: 1},
  searchWrap: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', margin: spacing.md, marginBottom: 6, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.border},
  search: {flex: 1, minHeight: 48, marginLeft: 8, color: colors.text},
  chips: {paddingHorizontal: spacing.md, paddingBottom: 8},
  chip: {paddingHorizontal: 16, height: 38, borderRadius: 19, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginRight: 8},
  chipOn: {backgroundColor: colors.primaryDark, borderColor: colors.primaryDark},
  chipText: {color: colors.text, fontSize: 14},
  chipTextOn: {color: '#fff', fontWeight: '700'},
  card: {backgroundColor: '#fff', borderRadius: 18, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.border},
  head: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6},
  code: {fontSize: 16, fontWeight: '800', color: colors.primaryDark, letterSpacing: 0.5},
  status: {flexDirection: 'row', alignItems: 'center'},
  statusText: {marginLeft: 4, fontWeight: '700', fontSize: 13},
  name: {fontWeight: '800', fontSize: 17, color: colors.text},
  muted: {color: colors.muted, marginTop: 2, fontSize: 13},
  line: {flexDirection: 'row', alignItems: 'center', marginTop: 6},
  lineText: {marginLeft: 8, color: colors.text, flex: 1, fontSize: 13},
  error: {color: colors.danger, marginTop: 8, fontSize: 13},
  playBtn: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryDark, borderRadius: 24, height: 44, marginTop: 12},
  playText: {color: '#fff', fontWeight: '800', marginLeft: 8},
});
