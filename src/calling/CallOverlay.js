import React, { useEffect, useState } from 'react';
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
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import CallVideo from './CallVideo';
import Avatar from './Avatar';
import { useCall } from './CallContext';
import { formatMobile } from './phone';
import AddPersonCard from '../meetings/AddPersonCard';

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

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// Every size on the call screen comes from here, so it fits a small phone, a big phone, a tablet and a phone
// turned sideways. The controls are drawn at most MAX_CONTENT wide (so on a tablet they stay in one comfortable
// column) and the buttons shrink until all of them fit in one row.
const MAX_CONTENT = 560;
export function callMetrics({ width, height, insets = {}, actionCount = 4 }) {
  const landscape = width > height;
  const short = Math.min(width, height);
  const scale = clamp(short / 390, 0.85, 1.2);
  const contentWidth = Math.min(width, MAX_CONTENT);
  const inner = contentWidth - 40; // the panel has 20 of padding on each side
  const endSize = Math.round(64 * scale);
  const actionSize = Math.floor(
    clamp((inner - endSize) / actionCount - 4, 40, 56 * scale),
  );
  const selfShort = Math.round(clamp(short * 0.27, 84, 150));
  const selfLong = Math.round(selfShort * 1.45);
  return {
    landscape,
    scale,
    contentWidth,
    actionSize,
    endSize,
    bigSize: Math.round(clamp(72 * scale, 64, 84)),
    avatar: Math.round(
      landscape ? clamp(height * 0.3, 72, 120) : clamp(width * 0.45, 110, 200),
    ),
    nameSize: Math.round(28 * clamp(scale, 0.9, 1.15)),
    headerTop: landscape ? 8 : 28,
    panelBottom: landscape ? 14 : 28,
    incomingBottom: landscape ? 20 : 56,
    selfWidth: landscape ? selfLong : selfShort,
    selfHeight: landscape ? selfShort : selfLong,
    selfTop: (insets.top || 0) + 56,
    selfRight: Math.max(insets.right || 0, 0) + 16,
  };
}

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

function Action({ icon, label, text, onPress, size, cell, active = false }) {
  return (
    <View style={[styles.action, cell && { width: cell }]}>
      <Pressable
        onPress={onPress}
        style={[
          styles.actionBtn,
          { width: size, height: size, borderRadius: size / 2 },
          active && styles.actionBtnActive,
        ]}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: active }}
      >
        <Icon
          name={icon}
          size={Math.round(size * 0.46)}
          color={active ? BG : '#fff'}
        />
      </Pressable>
      {!!text && (
        <Text
          style={styles.actionLabel}
          numberOfLines={1}
          maxFontSizeMultiplier={1.2}
        >
          {text}
        </Text>
      )}
    </View>
  );
}

function BigButton({ icon, label, color, onPress, size }) {
  return (
    <View style={styles.big}>
      <Pressable
        onPress={onPress}
        style={[
          styles.bigBtn,
          {
            backgroundColor: color,
            width: size,
            height: size,
            borderRadius: size / 2,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Icon name={icon} size={Math.round(size * 0.44)} color="#fff" />
      </Pressable>
      <Text style={styles.bigLabel} maxFontSizeMultiplier={1.2}>
        {label}
      </Text>
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
    addPersonToCall,
  } = useCall();
  const duration = useTimer(call?.connectedAt);
  const [addOpen, setAddOpen] = useState(false); // the "add someone by number" card
  const [minimized, setMinimized] = useState(false); // call shrunk to a bar so the app can be used
  const [slow, setSlow] = useState(false); // we have been calling for a while and they have not answered
  const callId = call?.id;
  const waiting =
    call?.direction === 'outgoing' &&
    (call?.status === 'calling' || call?.status === 'ringing');
  useEffect(() => {
    setMinimized(false);
  }, [callId]);
  useEffect(() => {
    setSlow(false);
    if (!waiting) {
      return;
    }
    const timer = setTimeout(() => setSlow(true), 15000);
    return () => clearTimeout(timer);
  }, [callId, waiting]);
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Recording is built on LiveKit, so a call that runs on Agora cannot be recorded
  const showRecord =
    recordingAvailable &&
    call?.provider !== 'agora' &&
    call?.status === 'connected';
  // Once the call is connected, a third person can be added by number (the call becomes a group call)
  const canAdd = call?.status === 'connected';
  const m = callMetrics({
    width: window.width,
    height: window.height,
    insets,
  });
  // The controls sit in a grid of three, with the name of each under it
  const cell = Math.floor((m.contentWidth - 40) / 3);
  const btn = clamp(cell - 28, 48, 68);

  if (!call) {
    return null;
  }

  const incoming = call.direction === 'incoming' && call.status === 'ringing';
  const ended = call.status === 'ended';

  if (minimized && !incoming && !ended) {
    return (
      <View
        style={[styles.miniWrap, { top: insets.top + 6 }]}
        pointerEvents="box-none"
      >
        <Pressable
          style={styles.mini}
          onPress={() => setMinimized(false)}
          accessibilityRole="button"
          accessibilityLabel="Return to call"
        >
          <Icon name="phone-in-talk" size={18} color="#fff" />
          <Text style={styles.miniText} numberOfLines={1}>
            {call.peer.name} · {statusText(call, duration)}
          </Text>
          <Text style={styles.miniTap}>Tap to return</Text>
        </Pressable>
      </View>
    );
  }
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
      {/* Inside a Modal the safe-area insets are not passed down, so the controls would sit under the nav bar */}
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: window.width, height: window.height },
          insets: { top: 0, left: 0, right: 0, bottom: 0, ...insets },
        }}
      >
        <View style={styles.screen}>
          {bigVideo && (
            <CallVideo
              trackRef={bigVideo}
              style={StyleSheet.absoluteFill}
              mirror={bigVideo === localVideo && frontCamera}
            />
          )}
          <SafeAreaView style={styles.content} edges={['top', 'bottom']}>
            <View style={styles.topBar}>
              {!incoming && !ended ? (
                <Pressable
                  style={styles.topBtn}
                  onPress={() => setMinimized(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Minimize call"
                >
                  <Icon name="arrow-collapse" size={22} color="#fff" />
                </Pressable>
              ) : (
                <View style={styles.topBtn} />
              )}
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
              {canAdd && !ended ? (
                <Pressable
                  style={styles.topBtn}
                  onPress={() => setAddOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Add person"
                >
                  <Icon name="account-plus" size={22} color="#fff" />
                </Pressable>
              ) : (
                <View style={styles.topBtn} />
              )}
            </View>

            <View style={[styles.header, { paddingTop: m.headerTop }]}>
              <Text
                style={[styles.name, { fontSize: m.nameSize }]}
                numberOfLines={1}
                maxFontSizeMultiplier={1.2}
              >
                {call.peer.name}
              </Text>
              {number !== call.peer.name && (
                <Text style={styles.number} maxFontSizeMultiplier={1.2}>
                  {number}
                </Text>
              )}
              <Text style={styles.status} maxFontSizeMultiplier={1.2}>
                {statusText(call, duration)}
              </Text>
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

            {slow && waiting && !ended && (
              <View style={styles.slowBanner}>
                <Text style={styles.slowText} maxFontSizeMultiplier={1.2}>
                  Still trying to reach {call.peer.name}
                </Text>
              </View>
            )}

            <View style={styles.middle}>
              {bigVideo ? null : (
                <Avatar
                  name={call.peer.name}
                  photo={call.peer.photo}
                  size={m.avatar}
                />
              )}
            </View>

            {/* The other person asks to record: nothing is recorded unless we allow it */}
            {recordingRequest && !ended && (
              <View style={[styles.consent, { width: m.contentWidth - 32 }]}>
                <Text style={styles.consentTitle} maxFontSizeMultiplier={1.2}>
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
              <View
                style={[
                  styles.incomingRow,
                  { paddingBottom: m.incomingBottom },
                ]}
              >
                <BigButton
                  icon="phone-hangup"
                  label="Decline"
                  color={RED}
                  size={m.bigSize}
                  onPress={rejectCall}
                />
                <BigButton
                  icon={call.video ? 'video' : 'phone'}
                  label="Accept"
                  color={GREEN}
                  size={m.bigSize}
                  onPress={acceptCall}
                />
              </View>
            ) : (
              <View style={[styles.panel, { paddingBottom: m.panelBottom }]}>
                <View style={styles.handle} />
                {ended ? (
                  <Text style={styles.endedText} maxFontSizeMultiplier={1.2}>
                    {call.endText}
                  </Text>
                ) : (
                  <View
                    style={[styles.actionsRow, { width: m.contentWidth - 40 }]}
                  >
                    <Action
                      icon="volume-high"
                      label="Speaker"
                      text="Speaker"
                      size={btn}
                      cell={cell}
                      active={speakerOn}
                      onPress={toggleSpeaker}
                    />
                    <Action
                      icon={cameraOn ? 'video' : 'video-off'}
                      label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
                      text="Video"
                      size={btn}
                      cell={cell}
                      active={cameraOn}
                      onPress={toggleCamera}
                    />
                    <Action
                      icon={muted ? 'microphone-off' : 'microphone'}
                      label={muted ? 'Unmute' : 'Mute'}
                      text={muted ? 'Unmute' : 'Mute'}
                      size={btn}
                      cell={cell}
                      active={muted}
                      onPress={toggleMute}
                    />
                    {localVideo && (
                      <Action
                        icon="camera-flip-outline"
                        label="Switch camera"
                        text="Flip"
                        size={btn}
                        cell={cell}
                        onPress={flipCamera}
                      />
                    )}
                    {showRecord && (
                      <Action
                        size={btn}
                        cell={cell}
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
                        text={recording === 'on' ? 'Stop' : 'Record'}
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
                    <View style={[styles.action, { width: cell }]}>
                      <Pressable
                        onPress={endCall}
                        style={[
                          styles.endBtn,
                          { width: btn, height: btn, borderRadius: btn / 2 },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="End call"
                      >
                        <Icon
                          name="phone-hangup"
                          size={Math.round(btn * 0.46)}
                          color="#fff"
                        />
                      </Pressable>
                      <Text
                        style={styles.actionLabel}
                        maxFontSizeMultiplier={1.2}
                      >
                        End
                      </Text>
                    </View>
                  </View>
                )}
              </View>
            )}
          </SafeAreaView>
          {addOpen && canAdd && !ended && (
            <AddPersonCard
              title="Add someone to this call"
              note="Their phone rings. This call becomes a group call."
              onAdd={addPersonToCall}
              onClose={() => setAddOpen(false)}
            />
          )}
          {smallVideo && (
            <View
              style={[
                styles.selfView,
                {
                  top: m.selfTop,
                  right: m.selfRight,
                  width: m.selfWidth,
                  height: m.selfHeight,
                },
              ]}
            >
              <CallVideo
                trackRef={localVideo}
                style={styles.fill}
                mirror={frontCamera}
                zOrder={1}
              />
            </View>
          )}
        </View>
      </SafeAreaProvider>
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
  topBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  slowBanner: {
    alignSelf: 'center',
    backgroundColor: PANEL,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 12,
    marginTop: 12,
  },
  slowText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  miniWrap: { position: 'absolute', left: 12, right: 12, zIndex: 50 },
  mini: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: GREEN,
    borderRadius: 22,
    paddingHorizontal: 14,
    height: 44,
    elevation: 8,
  },
  miniText: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 8,
  },
  miniTap: { color: '#fff', fontSize: 12, marginLeft: 8 },
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
    alignSelf: 'center',
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
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  action: { alignItems: 'center', marginBottom: 14 },
  actionLabel: { color: '#fff', fontSize: 13, marginTop: 6 },
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
