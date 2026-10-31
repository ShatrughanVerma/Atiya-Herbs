import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { VideoTrack } from '@livekit/react-native';
import Avatar from './Avatar';
import { useCall } from '../context/CallContext';
import { formatMobile } from '../utils/phone';

// WhatsApp-style call screen, shown above every screen. The audio and video come from LiveKit
// (see CallContext.js); this only draws them.

const BG = '#0B141A';
const PANEL = '#1F2C34';
const GREEN = '#25D366';
const RED = '#F15C6D';

const formatDuration = ms => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = n => String(n).padStart(2, '0');
  const hours = Math.floor(total / 3600);
  const clock = `${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  return hours ? `${hours}:${clock}` : clock;
};

function useTimer(connectedAt) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!connectedAt) {
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [connectedAt]);
  return connectedAt ? formatDuration(now - connectedAt) : '';
}

const statusText = (call, duration) => {
  switch (call.status) {
    case 'calling':
      return 'Calling…';
    case 'ringing':
      return call.direction === 'incoming'
        ? `Atiya Herbs ${call.video ? 'video' : 'voice'} call`
        : 'Ringing…';
    case 'connected':
      return duration;
    default:
      return call.endText;
  }
};

function Action({ icon, label, onPress, active = false }) {
  return (
    <View style={styles.action}>
      <Pressable
        onPress={onPress}
        style={[styles.actionBtn, active && styles.actionBtnActive]}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: active }}
      >
        <Icon name={icon} size={26} color={active ? BG : '#fff'} />
      </Pressable>
    </View>
  );
}

function BigButton({ icon, label, color, onPress }) {
  return (
    <View style={styles.big}>
      <Pressable
        onPress={onPress}
        style={[styles.bigBtn, { backgroundColor: color }]}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Icon name={icon} size={32} color="#fff" />
      </Pressable>
      <Text style={styles.bigLabel}>{label}</Text>
    </View>
  );
}

export default function CallOverlay() {
  const {
    call,
    muted,
    speakerOn,
    cameraOn,
    frontCamera,
    localVideo,
    remoteVideo,
    peerMedia,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleSpeaker,
    toggleCamera,
    flipCamera,
    recordingAvailable,
    recording,
    recordingRequest,
    requestRecording,
    respondRecording,
    stopRecording,
  } = useCall();
  const duration = useTimer(call?.connectedAt);

  if (!call) {
    return null;
  }

  const incoming = call.direction === 'incoming' && call.status === 'ringing';
  const ended = call.status === 'ended';
  const number = formatMobile(call.peer.id);
  const peerState = [
    peerMedia.muted && 'Muted',
    call.video && peerMedia.videoOff && 'Camera off',
  ].filter(Boolean);
  // The other person's video fills the screen with yours in the corner; before they join, yours fills it
  const bigVideo = !ended && (remoteVideo || (!call.connectedAt && localVideo));
  const smallVideo = !ended && remoteVideo && localVideo;

  return (
    <Modal
      visible
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => !incoming && !ended && endCall()}
    >
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      <View style={styles.screen}>
        {bigVideo && (
          <VideoTrack
            trackRef={bigVideo}
            style={styles.fill}
            objectFit="cover"
            mirror={bigVideo === localVideo && frontCamera}
          />
        )}
        <SafeAreaView style={styles.content} edges={['top', 'bottom']}>
          <View style={styles.topBar}>
            <View style={styles.topSide} />
            {recording === 'on' && !ended ? (
              <View
                style={styles.recordingBadge}
                accessibilityLabel="Recording"
              >
                <View style={styles.recordingDot} />
                <Text style={styles.recordingText}>Recording</Text>
              </View>
            ) : (
              <View style={styles.encrypted}>
                <Text style={styles.encryptedText}>Atiya Herbs call</Text>
              </View>
            )}
            <View style={styles.topSide} />
          </View>

          <View style={styles.header}>
            <Text style={styles.name} numberOfLines={1}>
              {call.peer.name}
            </Text>
            {number !== call.peer.name && (
              <Text style={styles.number}>{number}</Text>
            )}
            <Text style={styles.status}>{statusText(call, duration)}</Text>
            {!ended && peerState.length > 0 && (
              <View style={styles.peerState}>
                <Icon
                  name={peerMedia.muted ? 'microphone-off' : 'video-off'}
                  size={14}
                  color="#fff"
                />
                <Text style={styles.peerStateText}>
                  {peerState.join(' · ')}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.middle}>
            {bigVideo ? null : <Avatar name={call.peer.name} size={176} />}
          </View>

          {/* The other person asks to record: nothing is recorded unless we allow it */}
          {recordingRequest && !ended && (
            <View style={styles.consent}>
              <Text style={styles.consentTitle}>
                {recordingRequest.from.name} wants to record this call
              </Text>
              <Text style={styles.consentNote}>
                The recording is saved privately. You can stop it at any time.
              </Text>
              <View style={styles.consentButtons}>
                <Pressable
                  style={[styles.consentBtn, styles.consentDecline]}
                  onPress={() => respondRecording(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Do not allow recording"
                >
                  <Text style={styles.consentBtnText}>Not now</Text>
                </Pressable>
                <Pressable
                  style={[styles.consentBtn, styles.consentAllow]}
                  onPress={() => respondRecording(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Allow recording"
                >
                  <Text style={styles.consentBtnText}>Allow</Text>
                </Pressable>
              </View>
            </View>
          )}

          {incoming ? (
            <View style={styles.incomingRow}>
              <BigButton
                icon="phone-hangup"
                label="Decline"
                color={RED}
                onPress={rejectCall}
              />
              <BigButton
                icon={call.video ? 'video' : 'phone'}
                label="Accept"
                color={GREEN}
                onPress={acceptCall}
              />
            </View>
          ) : (
            <View style={styles.panel}>
              <View style={styles.handle} />
              {ended ? (
                <Text style={styles.endedText}>{call.endText}</Text>
              ) : (
                <View style={styles.actionsRow}>
                  <Action
                    icon="volume-high"
                    label="Speaker"
                    active={speakerOn}
                    onPress={toggleSpeaker}
                  />
                  <Action
                    icon={cameraOn ? 'video' : 'video-off'}
                    label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
                    active={cameraOn}
                    onPress={toggleCamera}
                  />
                  {localVideo && (
                    <Action
                      icon="camera-flip-outline"
                      label="Switch camera"
                      onPress={flipCamera}
                    />
                  )}
                  {recordingAvailable && call.status === 'connected' && (
                    <Action
                      icon={
                        recording === 'on'
                          ? 'record-circle'
                          : 'record-circle-outline'
                      }
                      label={
                        recording === 'on'
                          ? 'Stop recording'
                          : recording === 'asking'
                          ? 'Waiting for them to allow recording'
                          : 'Record call'
                      }
                      active={recording === 'on'}
                      onPress={
                        recording === 'on'
                          ? stopRecording
                          : recording === 'asking'
                          ? undefined
                          : requestRecording
                      }
                    />
                  )}
                  <Action
                    icon={muted ? 'microphone-off' : 'microphone'}
                    label={muted ? 'Unmute' : 'Mute'}
                    active={muted}
                    onPress={toggleMute}
                  />
                  <Pressable
                    onPress={endCall}
                    style={styles.endBtn}
                    accessibilityRole="button"
                    accessibilityLabel="End call"
                  >
                    <Icon name="phone-hangup" size={28} color="#fff" />
                  </Pressable>
                </View>
              )}
            </View>
          )}
        </SafeAreaView>
        {smallVideo && (
          <View style={styles.selfView}>
            <VideoTrack
              trackRef={localVideo}
              style={styles.fill}
              objectFit="cover"
              mirror={frontCamera}
              zOrder={1}
            />
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  content: { flex: 1 },
  fill: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  topSide: { width: 30 },
  recordingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: RED,
    marginRight: 6,
  },
  recordingText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  consent: {
    backgroundColor: PANEL,
    borderRadius: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
  },
  consentTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  consentNote: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    marginTop: 4,
  },
  consentButtons: { flexDirection: 'row', marginTop: 14 },
  consentBtn: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  consentDecline: { backgroundColor: 'rgba(255,255,255,0.15)', marginRight: 8 },
  consentAllow: { backgroundColor: GREEN, marginLeft: 8 },
  consentBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  encrypted: { flexDirection: 'row', alignItems: 'center' },
  encryptedText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    marginLeft: 4,
  },
  header: { alignItems: 'center', paddingTop: 28, paddingHorizontal: 24 },
  name: { color: '#fff', fontSize: 28, fontWeight: '500' },
  number: { color: 'rgba(255,255,255,0.6)', fontSize: 14, marginTop: 2 },
  status: { color: 'rgba(255,255,255,0.7)', fontSize: 16, marginTop: 6 },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  peerState: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  peerStateText: { color: '#fff', fontSize: 12, marginLeft: 4 },
  selfView: {
    position: 'absolute',
    top: 64,
    right: 16,
    width: 104,
    height: 150,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: '#000',
  },
  panel: {
    backgroundColor: PANEL,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 10,
    paddingBottom: 28,
    paddingHorizontal: 20,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginBottom: 22,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  action: { alignItems: 'center' },
  actionBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnActive: { backgroundColor: '#fff' },
  endBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: RED,
    alignItems: 'center',
    justifyContent: 'center',
  },
  endedText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    paddingVertical: 18,
  },
  incomingRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    paddingBottom: 56,
  },
  big: { alignItems: 'center' },
  bigBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigLabel: { color: '#fff', fontSize: 13, marginTop: 8 },
});
