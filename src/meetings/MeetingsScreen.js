import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import EmptyState from '../components/shop/EmptyState';
import ScreenHeader from '../components/shop/ScreenHeader';
import { useAuth } from '../context/AuthContext';
import { useCall } from '../calling/CallContext';
import { useMeeting } from './MeetingContext';
import { colors } from '../theme';

// Start a meeting, or join one with its id. A meeting is for many people at once (up to 25), each with their
// own video, with chat, and the host can manage it. (A call between two people is the Calls screen.)

const dayOf = iso =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

export default function MeetingsScreen({ navigation }) {
  const { user } = useAuth();
  const { myId, serverConnected } = useCall();
  const { status, createMeeting, joinMeeting, listMeetings } = useMeeting();
  const [title, setTitle] = useState('');
  const [joinId, setJoinId] = useState('');
  const [recent, setRecent] = useState([]);
  const busy = status !== 'idle';

  const refresh = useCallback(async () => {
    setRecent(await listMeetings());
  }, [listMeetings]);

  // load the list when the screen opens and again after a meeting ends
  useEffect(() => {
    if (myId && serverConnected && status === 'idle') {
      refresh();
    }
  }, [myId, serverConnected, status, refresh]);

  if (!user || !myId) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <ScreenHeader title="Meetings" navigation={navigation} />
        <EmptyState
          icon="account-group-outline"
          title="Log in to use meetings"
          note="Meetings use your mobile number, like calls. Log in and add your number to start or join one."
          actionLabel={user ? 'Add mobile number' : 'Log in'}
          onAction={() => navigation.navigate(user ? 'EditProfile' : 'Login')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader title="Meetings" navigation={navigation} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <FlatList
          data={recent}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Start a meeting</Text>
                <Text style={styles.cardNote}>
                  You are the host. Share the meeting id with up to 24 other
                  people.
                </Text>
                <TextInput
                  style={styles.input}
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Meeting name (optional)"
                  placeholderTextColor={colors.muted}
                  maxLength={80}
                  accessibilityLabel="Meeting name"
                />
                <Pressable
                  style={[styles.primary, busy && styles.disabled]}
                  disabled={busy}
                  onPress={() => createMeeting(title.trim())}
                  accessibilityRole="button"
                  accessibilityLabel="Start meeting"
                >
                  <Icon name="video" size={20} color="#fff" />
                  <Text style={styles.primaryText}>Start meeting</Text>
                </Pressable>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Join with a meeting id</Text>
                <TextInput
                  style={styles.input}
                  value={joinId}
                  onChangeText={setJoinId}
                  placeholder="abc-defg-hij"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={20}
                  accessibilityLabel="Meeting id"
                />
                <Pressable
                  style={[
                    styles.secondary,
                    (busy || !joinId.trim()) && styles.disabled,
                  ]}
                  disabled={busy || !joinId.trim()}
                  onPress={() => joinMeeting(joinId)}
                  accessibilityRole="button"
                  accessibilityLabel="Join meeting"
                >
                  <Icon name="login" size={20} color={colors.primary} />
                  <Text style={styles.secondaryText}>Join meeting</Text>
                </Pressable>
              </View>

              {recent.length > 0 && (
                <Text style={styles.sectionTitle}>Recent meetings</Text>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => setJoinId(item.id)}
              accessibilityLabel={`Meeting ${item.title}`}
            >
              <View style={styles.rowIcon}>
                <Icon
                  name={item.status === 'live' ? 'video' : 'video-outline'}
                  size={22}
                  color={item.status === 'live' ? colors.primary : colors.muted}
                />
              </View>
              <View style={styles.rowInfo}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.rowMeta}>
                  {item.id} · {dayOf(item.createdAt)}
                  {item.status === 'live' ? ' · live now' : ''}
                </Text>
              </View>
              {item.status === 'live' && (
                <Text style={styles.rowAction}>Tap to join</Text>
              )}
            </Pressable>
          )}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  list: { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  cardNote: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 4,
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 46,
    marginTop: 10,
    color: colors.text,
    fontSize: 15,
  },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 24,
    height: 48,
    marginTop: 12,
  },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: 24,
    height: 48,
    marginTop: 12,
  },
  secondaryText: { color: colors.primary, fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.muted,
    marginTop: 6,
    marginBottom: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  rowIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInfo: { flex: 1, marginHorizontal: 12 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  rowAction: { fontSize: 13, fontWeight: '700', color: colors.primary },
});
