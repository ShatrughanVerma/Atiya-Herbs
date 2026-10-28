import React, { useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Avatar from '../components/Avatar';
import EmptyState from '../components/shop/EmptyState';
import ScreenHeader from '../components/shop/ScreenHeader';
import { useAuth } from '../context/AuthContext';
import { useCall } from '../context/CallContext';
import {
  isContactPickerAvailable,
  pickContactNumber,
} from '../utils/contactPicker';
import { formatMobile, normalizeMobile } from '../utils/phone';
import { colors, spacing } from '../theme';

// WhatsApp-style Calls list: recent calls with direction and time, tap the phone / camera icon to
// call back, and the green button to call a new number. People are called by mobile number.

const timeOf = at =>
  new Date(at).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

const dayOf = at => {
  const date = new Date(at);
  const today = new Date();
  const startOfDay = d =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(today) - startOfDay(date)) / 86400000);
  if (days === 0) {
    return 'Today';
  }
  if (days === 1) {
    return 'Yesterday';
  }
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

const durationText = seconds => {
  if (!seconds) {
    return '';
  }
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? ` · ${m} min ${s} sec` : ` · ${s} sec`;
};

// Arrow icon and colour, like WhatsApp: green = answered, red = missed / declined
const directionOf = item => {
  const missed =
    item.direction === 'incoming' &&
    (item.outcome === 'missed' || item.outcome === 'declined');
  if (item.direction === 'outgoing') {
    return {
      icon: 'arrow-top-right',
      color: item.outcome === 'answered' ? colors.primary : colors.muted,
    };
  }
  return {
    icon: 'arrow-bottom-left',
    color: missed ? colors.danger : colors.primary,
  };
};

function DialSheet({ visible, onClose, onCall }) {
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  // Keep the buttons above the phone's navigation bar (3 buttons or gesture bar)
  const { bottom } = useSafeAreaInsets();

  const close = () => {
    setNumber('');
    setName('');
    onClose();
  };

  const place = video => {
    const mobile = normalizeMobile(number);
    if (!mobile) {
      Alert.alert(
        'Mobile number',
        'Please enter a valid 10-digit mobile number.',
      );
      return;
    }
    onCall({ id: mobile, name: name || formatMobile(mobile) }, video);
    close();
  };

  const chooseContact = async () => {
    try {
      const contact = await pickContactNumber();
      if (!contact) {
        return;
      }
      const mobile = normalizeMobile(contact.number);
      if (!mobile) {
        Alert.alert(
          'Mobile number',
          `${contact.number} is not an Indian mobile number.`,
        );
        return;
      }
      setNumber(mobile);
      setName(contact.name || '');
    } catch (e) {
      Alert.alert('Contacts', e.message || 'Could not open your contacts.');
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
      statusBarTranslucent
    >
      {/* Lifts the sheet above the keyboard */}
      <KeyboardAvoidingView style={styles.sheetHost} behavior="padding">
        <Pressable style={styles.backdrop} onPress={close} />
        <View style={[styles.sheet, { paddingBottom: spacing.lg + bottom }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>New call</Text>
          <View style={styles.inputBox}>
            <Text style={styles.prefix}>+91</Text>
            <TextInput
              style={styles.input}
              value={number}
              onChangeText={v => {
                setNumber(v.replace(/[^0-9+ ]/g, ''));
                setName('');
              }}
              placeholder="Mobile number"
              placeholderTextColor={colors.muted}
              keyboardType="phone-pad"
              maxLength={16}
              autoFocus
              accessibilityLabel="Mobile number to call"
            />
            {isContactPickerAvailable && (
              <Pressable
                onPress={chooseContact}
                hitSlop={8}
                accessibilityLabel="Choose from contacts"
              >
                <Icon
                  name="account-box-outline"
                  size={26}
                  color={colors.primary}
                />
              </Pressable>
            )}
          </View>
          {!!name && <Text style={styles.contactName}>{name}</Text>}
          <View style={styles.sheetButtons}>
            <Pressable
              style={[styles.sheetBtn, styles.voiceBtn]}
              onPress={() => place(false)}
            >
              <Icon name="phone" size={20} color="#fff" />
              <Text style={styles.sheetBtnText}>Voice call</Text>
            </Pressable>
            <Pressable
              style={[styles.sheetBtn, styles.videoBtn]}
              onPress={() => place(true)}
            >
              <Icon name="video" size={20} color="#fff" />
              <Text style={styles.sheetBtnText}>Video call</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function CallsScreen({ navigation }) {
  const { user } = useAuth();
  const { myId, serverConnected, history, startCall, clearHistory } = useCall();
  const [dialOpen, setDialOpen] = useState(false);
  // An absolutely placed button ignores the screen's bottom padding, so lift it above the
  // phone's navigation bar itself
  const { bottom } = useSafeAreaInsets();

  const confirmClear = () =>
    Alert.alert('Clear call log', 'Remove all calls from this list?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: clearHistory },
    ]);

  if (!user) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <ScreenHeader title="Calls" navigation={navigation} />
        <EmptyState
          icon="phone-outline"
          title="Log in to make calls"
          note="Voice and video calls need an account so the other person knows who is calling."
          actionLabel="Log in"
          onAction={() => navigation.navigate('Login')}
        />
      </SafeAreaView>
    );
  }

  if (!myId) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <ScreenHeader title="Calls" navigation={navigation} />
        <EmptyState
          icon="cellphone-message"
          title="Add your mobile number"
          note="People call you on your mobile number, like WhatsApp. Add it to your profile to start calling."
          actionLabel="Add mobile number"
          onAction={() => navigation.navigate('EditProfile')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader
        title="Calls"
        navigation={navigation}
        right={
          history.length > 0 ? (
            <Pressable
              style={styles.headerBtn}
              onPress={confirmClear}
              accessibilityLabel="Clear call log"
            >
              <Icon name="delete-outline" size={22} color={colors.text} />
            </Pressable>
          ) : undefined
        }
      />

      <FlatList
        data={history}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={[styles.preview, serverConnected && styles.online]}>
            <View
              style={[
                styles.dot,
                serverConnected ? styles.dotOn : styles.dotOff,
              ]}
            />
            <Text style={styles.previewText}>
              {serverConnected
                ? `Others can call you on ${formatMobile(myId)}`
                : 'Connecting to the call server…'}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="phone-outline"
            title="No calls yet"
            note="Tap the green button to call a mobile number. Your recent calls will show here."
          />
        }
        renderItem={({ item }) => {
          const arrow = directionOf(item);
          const missed = arrow.color === colors.danger;
          return (
            <View style={styles.row}>
              <Avatar name={item.peer.name} size={50} />
              <View style={styles.info}>
                <Text
                  style={[styles.name, missed && styles.missed]}
                  numberOfLines={1}
                >
                  {item.peer.name}
                </Text>
                <View style={styles.meta}>
                  <Icon name={arrow.icon} size={16} color={arrow.color} />
                  <Text style={styles.metaText} numberOfLines={1}>
                    {` ${dayOf(item.at)}, ${timeOf(item.at)}${durationText(
                      item.duration,
                    )}`}
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={() => startCall(item.peer, item.video)}
                hitSlop={10}
                accessibilityLabel={`${item.video ? 'Video' : 'Voice'} call ${
                  item.peer.name
                }`}
              >
                <Icon
                  name={item.video ? 'video-outline' : 'phone-outline'}
                  size={26}
                  color={colors.primary}
                />
              </Pressable>
            </View>
          );
        }}
      />

      <Pressable
        style={[styles.fab, { bottom: spacing.lg + bottom }]}
        onPress={() => setDialOpen(true)}
        accessibilityLabel="New call"
      >
        <Icon name="phone-plus" size={26} color="#fff" />
      </Pressable>

      <DialSheet
        visible={dialOpen}
        onClose={() => setDialOpen(false)}
        onCall={startCall}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { flexGrow: 1, paddingBottom: 96 },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accentLight,
    margin: spacing.md,
    padding: spacing.sm + 2,
    borderRadius: 10,
  },
  previewText: {
    flex: 1,
    marginLeft: spacing.sm,
    color: colors.text,
    fontSize: 13,
  },
  online: { backgroundColor: colors.primaryLight },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotOn: { backgroundColor: '#25D366' },
  dotOff: { backgroundColor: colors.offer },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  info: { flex: 1, marginHorizontal: spacing.md },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  missed: { color: colors.danger },
  meta: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  metaText: { flexShrink: 1, fontSize: 13, color: colors.muted },
  fab: {
    position: 'absolute',
    right: spacing.md + 4,
    bottom: spacing.lg,
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: '#25D366',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
  },
  sheetHost: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    paddingTop: spacing.sm + 2,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    height: 52,
    backgroundColor: colors.card,
  },
  prefix: { fontSize: 16, color: colors.muted, marginRight: spacing.sm },
  input: { flex: 1, fontSize: 17, color: colors.text, paddingVertical: 0 },
  contactName: {
    color: colors.primary,
    fontSize: 13,
    marginTop: 6,
    marginLeft: 4,
  },
  sheetButtons: { flexDirection: 'row', marginTop: spacing.lg },
  sheetBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: 24,
  },
  voiceBtn: { backgroundColor: colors.primary, marginRight: spacing.sm },
  videoBtn: { backgroundColor: colors.accent, marginLeft: spacing.sm },
  sheetBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
    marginLeft: 8,
  },
});
