import React from 'react';
import {
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Avatar from '../calling/Avatar';
import { callMetrics } from '../calling/CallOverlay';
import { formatMobile } from '../calling/phone';
import { useConference } from './ConferenceContext';

// "X is adding you to a call": the ringing screen for someone who is added to a group call, like an incoming
// call. Accept joins the call; Decline tells the person who rang.

const BG = '#0B141A';
const GREEN = '#25D366';
const RED = '#F15C6D';

export default function ConferenceInvite() {
  const { invitation, acceptInvitation, declineInvitation } = useConference();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  if (!invitation) {
    return null;
  }
  const m = callMetrics({
    width: window.width,
    height: window.height,
    insets,
  });
  const number = formatMobile(invitation.from.id);

  return (
    <Modal
      visible
      animationType="fade"
      statusBarTranslucent
      onRequestClose={declineInvitation}
    >
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.kind} maxFontSizeMultiplier={1.2}>
            Atiya Herbs group {invitation.video ? 'video' : 'voice'} call
          </Text>
          <Text
            style={[styles.name, { fontSize: m.nameSize }]}
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
          >
            {invitation.from.name}
          </Text>
          {number !== invitation.from.name && (
            <Text style={styles.number} maxFontSizeMultiplier={1.2}>
              {number}
            </Text>
          )}
          <Text style={styles.status} maxFontSizeMultiplier={1.2}>
            is adding you to a group call
          </Text>
        </View>
        <View style={styles.middle}>
          <Avatar name={invitation.from.name} size={m.avatar} />
        </View>
        <View style={[styles.row, { paddingBottom: m.incomingBottom }]}>
          <View style={styles.big}>
            <Pressable
              onPress={declineInvitation}
              style={[
                styles.bigBtn,
                {
                  backgroundColor: RED,
                  width: m.bigSize,
                  height: m.bigSize,
                  borderRadius: m.bigSize / 2,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Decline"
            >
              <Icon
                name="phone-hangup"
                size={Math.round(m.bigSize * 0.44)}
                color="#fff"
              />
            </Pressable>
            <Text style={styles.bigLabel}>Decline</Text>
          </View>
          <View style={styles.big}>
            <Pressable
              onPress={acceptInvitation}
              style={[
                styles.bigBtn,
                {
                  backgroundColor: GREEN,
                  width: m.bigSize,
                  height: m.bigSize,
                  borderRadius: m.bigSize / 2,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Accept"
            >
              <Icon
                name={invitation.video ? 'video' : 'phone'}
                size={Math.round(m.bigSize * 0.44)}
                color="#fff"
              />
            </Pressable>
            <Text style={styles.bigLabel}>Accept</Text>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: { alignItems: 'center', paddingTop: 36, paddingHorizontal: 24 },
  kind: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },
  name: { color: '#fff', fontWeight: '500', marginTop: 10 },
  number: { color: 'rgba(255,255,255,0.6)', fontSize: 14, marginTop: 2 },
  status: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 16,
    marginTop: 8,
    textAlign: 'center',
  },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-evenly' },
  big: { alignItems: 'center' },
  bigBtn: { alignItems: 'center', justifyContent: 'center' },
  bigLabel: { color: '#fff', fontSize: 13, marginTop: 8 },
});
