import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Avatar from '../calling/Avatar';
import CallVideo from '../calling/CallVideo';
import AddPersonCard from './AddPersonCard';
import { callMetrics } from '../calling/CallOverlay';
import { useMeeting } from './MeetingContext';
import {
  MAX_TILES,
  formatTimer,
  gridMetrics,
  meetingLink,
  orderTiles,
  pickStage,
} from './meetingLayout';

// The meeting screen, shown above every screen while you are in a meeting (like the call screen): a grid of
// everyone's video, the buttons, and two panels that slide up: People (with the host's controls) and Chat.

const BG = '#0B141A';
const PANEL = '#1F2C34';
const GREEN = '#25D366';
const RED = '#F15C6D';
const ORANGE = '#FF8D2F';

function useTimer(startedAt) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) {
      return undefined;
    }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return startedAt ? formatTimer(now - Date.parse(startedAt)) : '';
}

function RoundButton({ icon, label, onPress, size, active, danger, badge }) {
  return (
    <View style={styles.roundWrap}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: !!active }}
        style={[
          styles.round,
          { width: size, height: size, borderRadius: size / 2 },
          active && styles.roundActive,
          danger && styles.roundDanger,
        ]}
      >
        <Icon
          name={icon}
          size={Math.round(size * 0.46)}
          color={active ? BG : '#fff'}
        />
      </Pressable>
      {badge > 0 && (
        <View style={styles.badge} accessibilityLabel={`${badge} unread`}>
          <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      )}
    </View>
  );
}

function Tile({ person, width, height, frontCamera, sharing, onStopSharing }) {
  const showVideo =
    person.videoOn && person.uid !== undefined && !(person.isMe && sharing);
  return (
    <View
      style={[
        styles.tile,
        { width, height },
        person.speaking && styles.tileSpeaking,
      ]}
      accessibilityLabel={`${person.name}${person.isMe ? ' (you)' : ''}`}
    >
      {showVideo ? (
        <CallVideo
          trackRef={{ agora: true, uid: person.uid }}
          style={styles.fill}
          mirror={person.isMe && frontCamera}
        />
      ) : (
        <View style={styles.tileEmpty}>
          <Avatar
            name={person.name}
            size={Math.round(Math.min(width, height) * 0.4)}
          />
          {person.isMe && sharing && (
            <Pressable onPress={onStopSharing} style={styles.stopShare}>
              <Text style={styles.stopShareText}>
                You are sharing your screen. Tap to stop.
              </Text>
            </Pressable>
          )}
        </View>
      )}
      <View style={styles.tileLabel}>
        {person.role === 'host' && (
          <Icon name="shield-account" size={14} color={ORANGE} />
        )}
        {person.sharing && (
          <Icon name="monitor-share" size={14} color={GREEN} />
        )}
        {person.muted && <Icon name="microphone-off" size={14} color="#fff" />}
        <Text style={styles.tileName} numberOfLines={1}>
          {person.isMe ? `${person.name} (you)` : person.name}
          {person.offline ? ' · reconnecting' : ''}
        </Text>
      </View>
    </View>
  );
}

function MoreTile({ count, width, height, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tile, styles.tileEmpty, { width, height }]}
      accessibilityRole="button"
      accessibilityLabel={`${count} more people`}
    >
      <Text style={styles.moreText}>+{count}</Text>
      <Text style={styles.moreNote}>more people</Text>
    </Pressable>
  );
}

function PeoplePanel({ onClose, onLeaveOrEnd, onAddPerson }) {
  const {
    people,
    invited,
    cancelInvite,
    meeting,
    isHost,
    muteAll,
    muteParticipant,
    removeParticipant,
    setLocked,
  } = useMeeting();
  const confirmRemove = p =>
    Alert.alert(
      'Remove from meeting',
      `Remove ${p.name}? They cannot rejoin.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeParticipant(p.id),
        },
      ],
    );
  return (
    <View style={styles.sheet}>
      <View style={styles.sheetHead}>
        <Text style={styles.sheetTitle}>People ({people.length})</Text>
        <Pressable onPress={onClose} accessibilityLabel="Close people">
          <Icon name="close" size={24} color="#fff" />
        </Pressable>
      </View>
      {isHost && (
        <View style={styles.hostBar}>
          <Pressable
            style={styles.hostBtn}
            onPress={muteAll}
            accessibilityRole="button"
            accessibilityLabel="Mute everyone"
          >
            <Icon name="microphone-off" size={18} color="#fff" />
            <Text style={styles.hostBtnText}>Mute all</Text>
          </Pressable>
          <View style={styles.lockRow}>
            <Text style={styles.hostBtnText}>Lock meeting</Text>
            <Switch
              value={!!meeting?.locked}
              onValueChange={setLocked}
              accessibilityLabel="Lock meeting"
            />
          </View>
        </View>
      )}
      <Pressable
        style={styles.addRow}
        onPress={onAddPerson}
        accessibilityRole="button"
        accessibilityLabel="Add people"
      >
        <View style={styles.addIcon}>
          <Icon name="account-plus" size={22} color="#fff" />
        </View>
        <Text style={styles.addText}>Add people by mobile number</Text>
      </Pressable>
      {invited.map(i => {
        const mine = i.by === people.find(p => p.isMe)?.id;
        return (
          <View key={i.id} style={styles.personRow}>
            <Avatar name={i.name} size={38} />
            <View style={styles.personInfo}>
              <Text style={styles.personName} numberOfLines={1}>
                {i.name}
              </Text>
              <Text style={styles.personRole}>Ringing…</Text>
            </View>
            {(mine || isHost) && (
              <Pressable
                onPress={() => cancelInvite(i.id)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Stop ringing ${i.name}`}
              >
                <Icon name="close-circle-outline" size={24} color={RED} />
              </Pressable>
            )}
          </View>
        );
      })}
      <FlatList
        data={people}
        keyExtractor={p => p.id}
        renderItem={({ item: p }) => (
          <View style={styles.personRow}>
            <Avatar name={p.name} size={38} />
            <View style={styles.personInfo}>
              <Text style={styles.personName} numberOfLines={1}>
                {p.name}
                {p.isMe ? ' (you)' : ''}
              </Text>
              <Text style={styles.personRole}>
                {p.role === 'host' ? 'Host' : 'Participant'}
                {p.offline ? ' · reconnecting' : ''}
              </Text>
            </View>
            <Icon
              name={p.muted ? 'microphone-off' : 'microphone'}
              size={20}
              color={p.muted ? RED : '#fff'}
            />
            <Icon
              name={p.videoOn ? 'video' : 'video-off'}
              size={20}
              color={p.videoOn ? '#fff' : 'rgba(255,255,255,0.4)'}
              style={styles.personIcon}
            />
            {isHost && !p.isMe && (
              <View style={styles.personActions}>
                <Pressable
                  onPress={() => muteParticipant(p.id)}
                  hitSlop={8}
                  accessibilityLabel={`Mute ${p.name}`}
                >
                  <Icon name="microphone-off" size={22} color={ORANGE} />
                </Pressable>
                <Pressable
                  onPress={() => confirmRemove(p)}
                  hitSlop={8}
                  accessibilityLabel={`Remove ${p.name}`}
                >
                  <Icon name="account-remove" size={22} color={RED} />
                </Pressable>
              </View>
            )}
          </View>
        )}
      />
      <Pressable
        style={styles.leaveRow}
        onPress={onLeaveOrEnd}
        accessibilityRole="button"
        accessibilityLabel="Leave meeting"
      >
        <Icon name="exit-run" size={20} color={RED} />
        <Text style={styles.leaveText}>
          {isHost ? 'Leave or end the meeting' : 'Leave meeting'}
        </Text>
      </Pressable>
    </View>
  );
}

// How far the keyboard covers the bottom of the screen. Inside a full-screen Modal the window does not shrink
// when the keyboard opens, so a panel with a text box has to lift itself.
function useKeyboardLift() {
  const insets = useSafeAreaInsets();
  const [lift, setLift] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', e => {
      const bottomOfScreen = Dimensions.get('screen').height - insets.bottom;
      setLift(Math.max(0, bottomOfScreen - e.endCoordinates.screenY));
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setLift(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [insets.bottom]);
  return lift;
}

function ChatPanel({ onClose }) {
  const { chat, sendChat, setChatOpen } = useMeeting();
  const lift = useKeyboardLift();
  const [text, setText] = useState('');
  const list = useRef(null);
  useEffect(() => {
    setChatOpen(true);
    return () => setChatOpen(false);
  }, [setChatOpen]);
  useEffect(() => {
    list.current?.scrollToEnd?.({ animated: true });
  }, [chat.length]);
  const submit = async () => {
    const sending = text;
    if (!sending.trim()) {
      return;
    }
    setText('');
    if (!(await sendChat(sending))) {
      setText(sending); // keep what was typed when it did not go
    }
  };
  const { myId } = useMeetingIdentity();
  return (
    <View style={[styles.sheet, { bottom: lift }]}>
      <View style={styles.sheetHead}>
        <Text style={styles.sheetTitle}>Chat</Text>
        <Pressable onPress={onClose} accessibilityLabel="Close chat">
          <Icon name="close" size={24} color="#fff" />
        </Pressable>
      </View>
      <FlatList
        ref={list}
        data={chat}
        keyExtractor={m => m.id}
        style={styles.chatList}
        ListEmptyComponent={
          <Text style={styles.chatEmpty}>No messages yet. Say hello.</Text>
        }
        renderItem={({ item }) => {
          const mine = item.from.id === myId;
          return (
            <View style={[styles.msgWrap, mine && styles.msgWrapMine]}>
              <View style={[styles.msg, mine && styles.msgMine]}>
                {!mine && <Text style={styles.msgFrom}>{item.from.name}</Text>}
                <Text style={styles.msgText}>{item.text}</Text>
              </View>
            </View>
          );
        }}
      />
      <View style={styles.chatInputRow}>
        <TextInput
          style={styles.chatInput}
          value={text}
          onChangeText={setText}
          placeholder="Message everyone"
          placeholderTextColor="rgba(255,255,255,0.5)"
          maxLength={1000}
          multiline
          accessibilityLabel="Chat message"
        />
        <Pressable
          onPress={submit}
          style={styles.sendBtn}
          accessibilityRole="button"
          accessibilityLabel="Send message"
        >
          <Icon name="send" size={22} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

// the id of the person using this phone (the context already knows it through the people list)
function useMeetingIdentity() {
  const { people } = useMeeting();
  return { myId: people.find(p => p.isMe)?.id };
}

export default function MeetingRoom() {
  const {
    status,
    meeting,
    people,
    isHost,
    muted,
    cameraOn,
    speakerOn,
    frontCamera,
    sharing,
    connection,
    notice,
    unread,
    toggleMute,
    toggleCamera,
    flipCamera,
    toggleSpeaker,
    toggleScreenShare,
    leaveMeeting,
    endMeeting,
    setVisibleAccounts,
    inviteByNumber,
  } = useMeeting();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [panel, setPanel] = useState(null); // null | 'people' | 'chat'
  const [adding, setAdding] = useState(false); // the "add someone by number" card
  const [pinnedId, setPinnedId] = useState(null); // the person you tapped to have on the big tile
  const [area, setArea] = useState({
    width: window.width,
    height: window.height - 220,
  });
  const timer = useTimer(meeting?.startedAt);

  const speakingId = people.find(p => p.speaking)?.id;
  const ordered = useMemo(
    () =>
      orderTiles(people, {
        myId: people.find(p => p.isMe)?.id,
        speakingId,
        sharingId: meeting?.sharingId,
      }),
    [people, speakingId, meeting?.sharingId],
  );
  const extra = Math.max(0, ordered.length - MAX_TILES);
  const tiles = extra ? ordered.slice(0, MAX_TILES - 1) : ordered;
  const slots = tiles.length + (extra ? 1 : 0);
  const grid = gridMetrics({
    width: area.width,
    height: area.height,
    count: slots,
  });
  // three or more people on a tall screen: one big tile with a row under it you swipe sideways
  const stage = grid.horizontal
    ? pickStage(tiles, { pinnedId, sharingId: meeting?.sharingId, speakingId })
    : null;
  const strip = stage ? tiles.filter(p => p.id !== stage.id) : [];

  // only the people on screen have their video downloaded
  const shownKey = tiles.map(p => p.id).join(',');
  useEffect(() => {
    setVisibleAccounts(shownKey ? shownKey.split(',') : []);
  }, [shownKey, setVisibleAccounts]);

  if (status === 'idle') {
    return null;
  }
  if (status === 'joining') {
    return (
      <Modal visible animationType="fade" statusBarTranslucent>
        <View style={styles.joining}>
          <Text style={styles.joiningText}>Joining the meeting…</Text>
        </View>
      </Modal>
    );
  }

  const showButtons =
    4 + (cameraOn ? 1 : 0) + (Platform.OS === 'android' ? 1 : 0);
  const m = callMetrics({
    width: window.width,
    height: window.height,
    insets,
    actionCount: showButtons + 1, // + people
  });

  const confirmLeave = () => {
    if (isHost && people.length > 1) {
      Alert.alert(
        'Leave meeting',
        'Leave and keep it going, or end it for everyone?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Leave', onPress: leaveMeeting },
          { text: 'End for all', style: 'destructive', onPress: endMeeting },
        ],
      );
    } else {
      Alert.alert('Leave meeting', 'Leave this meeting?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: leaveMeeting },
      ]);
    }
  };
  const shareInvite = () =>
    Share.share({
      message: `Join my Atiya Herbs meeting "${meeting.title}"\nMeeting ID: ${
        meeting.id
      }\n${meetingLink(meeting.id)}`,
    }).catch(() => {});
  const sharer = people.find(p => p.id === meeting?.sharingId);

  return (
    <Modal
      visible
      animationType="fade"
      statusBarTranslucent
      onRequestClose={confirmLeave}
    >
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      {/* Inside a Modal the safe-area insets are not passed down, so the bottom buttons and chat box sit under the nav bar */}
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: window.width, height: window.height },
          insets: { top: 0, left: 0, right: 0, bottom: 0, ...insets },
        }}
      >
        <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
          <View style={styles.topBar}>
            <View style={styles.topInfo}>
              <Text
                style={styles.title}
                numberOfLines={1}
                maxFontSizeMultiplier={1.2}
              >
                {meeting.title}
              </Text>
              <Text style={styles.subtitle} maxFontSizeMultiplier={1.2}>
                {meeting.id} · {timer} · {people.length} in meeting
                {meeting.locked ? ' · locked' : ''}
              </Text>
            </View>
            <Pressable
              onPress={shareInvite}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Share meeting invite"
            >
              <Icon name="share-variant" size={24} color="#fff" />
            </Pressable>
          </View>

          {(connection === 'reconnecting' || notice || sharer) && (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>
                {connection === 'reconnecting'
                  ? 'Reconnecting…'
                  : notice ||
                    `${
                      sharer.isMe ? 'You are' : `${sharer.name} is`
                    } sharing their screen`}
              </Text>
            </View>
          )}

          <View
            style={styles.gridArea}
            onLayout={e =>
              setArea({
                width: e.nativeEvent.layout.width,
                height: e.nativeEvent.layout.height,
              })
            }
          >
            {grid.horizontal ? (
              <View style={{ gap: grid.gap }}>
                <Pressable
                  onPress={() => setPinnedId(null)}
                  accessibilityLabel="Main speaker"
                >
                  <Tile
                    person={stage}
                    width={grid.stageWidth}
                    height={grid.stageHeight}
                    frontCamera={frontCamera}
                    sharing={sharing}
                    onStopSharing={toggleScreenShare}
                  />
                </Pressable>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: grid.gap }}
                  accessibilityLabel="Everyone else in the meeting"
                >
                  {strip.map(p => (
                    <Pressable
                      key={p.id}
                      onPress={() => setPinnedId(p.id)}
                      accessibilityLabel={`Show ${p.name} on the big screen`}
                    >
                      <Tile
                        person={p}
                        width={grid.tileWidth}
                        height={grid.tileHeight}
                        frontCamera={frontCamera}
                        sharing={sharing}
                        onStopSharing={toggleScreenShare}
                      />
                    </Pressable>
                  ))}
                  {extra > 0 && (
                    <MoreTile
                      count={extra + 1}
                      width={grid.tileWidth}
                      height={grid.tileHeight}
                      onPress={() => setPanel('people')}
                    />
                  )}
                </ScrollView>
              </View>
            ) : (
              <View style={[styles.grid, { gap: grid.gap }]}>
                {tiles.map(p => (
                  <Tile
                    key={p.id}
                    person={p}
                    width={grid.tileWidth}
                    height={grid.tileHeight}
                    frontCamera={frontCamera}
                    sharing={sharing}
                    onStopSharing={toggleScreenShare}
                  />
                ))}
                {extra > 0 && (
                  <MoreTile
                    count={extra + 1}
                    width={grid.tileWidth}
                    height={grid.tileHeight}
                    onPress={() => setPanel('people')}
                  />
                )}
              </View>
            )}
          </View>

          <View style={styles.controls}>
            <RoundButton
              icon={muted ? 'microphone-off' : 'microphone'}
              label={muted ? 'Unmute' : 'Mute'}
              active={muted}
              size={m.actionSize}
              onPress={toggleMute}
            />
            <RoundButton
              icon={cameraOn ? 'video' : 'video-off'}
              label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
              active={cameraOn}
              size={m.actionSize}
              onPress={toggleCamera}
            />
            {cameraOn && (
              <RoundButton
                icon="camera-flip-outline"
                label="Switch camera"
                size={m.actionSize}
                onPress={flipCamera}
              />
            )}
            <RoundButton
              icon={speakerOn ? 'volume-high' : 'phone-in-talk'}
              label={speakerOn ? 'Use earpiece' : 'Use speaker'}
              active={speakerOn}
              size={m.actionSize}
              onPress={toggleSpeaker}
            />
            {Platform.OS === 'android' && (
              <RoundButton
                icon="monitor-share"
                label={sharing ? 'Stop sharing' : 'Share screen'}
                active={sharing}
                size={m.actionSize}
                onPress={toggleScreenShare}
              />
            )}
            <RoundButton
              icon="account-group"
              label="People"
              active={panel === 'people'}
              size={m.actionSize}
              onPress={() => setPanel(panel === 'people' ? null : 'people')}
            />
            <RoundButton
              icon="message-text"
              label="Chat"
              active={panel === 'chat'}
              badge={panel === 'chat' ? 0 : unread}
              size={m.actionSize}
              onPress={() => setPanel(panel === 'chat' ? null : 'chat')}
            />
            <RoundButton
              icon="phone-hangup"
              label="Leave meeting"
              danger
              size={m.actionSize}
              onPress={confirmLeave}
            />
          </View>

          {panel === 'people' && (
            <PeoplePanel
              onClose={() => setPanel(null)}
              onLeaveOrEnd={confirmLeave}
              onAddPerson={() => setAdding(true)}
            />
          )}
          {panel === 'chat' && <ChatPanel onClose={() => setPanel(null)} />}
          {adding && (
            <AddPersonCard
              title="Add people to this meeting"
              note="Their phone rings, and they join when they accept."
              onAdd={inviteByNumber}
              onClose={() => setAdding(false)}
            />
          )}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  fill: { flex: 1 },
  joining: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joiningText: { color: '#fff', fontSize: 18 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  topInfo: { flex: 1, marginRight: 12 },
  title: { color: '#fff', fontSize: 18, fontWeight: '600' },
  subtitle: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 },
  banner: {
    backgroundColor: 'rgba(255,141,47,0.2)',
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  bannerText: { color: '#fff', fontSize: 13, textAlign: 'center' },
  gridArea: { flex: 1, paddingHorizontal: 8, paddingBottom: 8 },
  grid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'center',
    justifyContent: 'center',
  },
  tile: {
    backgroundColor: '#111B21',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tileSpeaking: { borderColor: ORANGE },
  tileEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tileLabel: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tileName: { color: '#fff', fontSize: 12, flexShrink: 1 },
  stopShare: { marginTop: 10, paddingHorizontal: 12 },
  stopShareText: { color: GREEN, fontSize: 12, textAlign: 'center' },
  moreText: { color: '#fff', fontSize: 28, fontWeight: '700' },
  moreNote: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  controls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: PANEL,
  },
  roundWrap: { alignItems: 'center' },
  round: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  roundActive: { backgroundColor: '#fff' },
  roundDanger: { backgroundColor: RED },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: '28%',
    backgroundColor: PANEL,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sheetTitle: { color: '#fff', fontSize: 18, fontWeight: '600' },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    marginBottom: 4,
  },
  addIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addText: { color: '#fff', fontSize: 15, marginLeft: 12 },
  hostBar: { marginBottom: 8, gap: 8 },
  hostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 20,
    paddingHorizontal: 14,
    height: 40,
    alignSelf: 'flex-start',
  },
  hostBtnText: { color: '#fff', fontSize: 14 },
  lockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  personRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  personInfo: { flex: 1, marginHorizontal: 12 },
  personName: { color: '#fff', fontSize: 15 },
  personRole: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  personIcon: { marginLeft: 10 },
  personActions: { flexDirection: 'row', gap: 14, marginLeft: 14 },
  leaveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 12,
  },
  leaveText: { color: RED, fontSize: 15, fontWeight: '600' },
  chatList: { flex: 1 },
  chatEmpty: {
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    marginTop: 24,
  },
  msgWrap: { marginVertical: 3, alignItems: 'flex-start' },
  msgWrapMine: { alignItems: 'flex-end' },
  msg: {
    maxWidth: '82%',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  msgMine: { backgroundColor: '#075E54' },
  msgFrom: { color: ORANGE, fontSize: 12, fontWeight: '600', marginBottom: 2 },
  msgText: { color: '#fff', fontSize: 15 },
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingTop: 8,
  },
  chatInput: {
    flex: 1,
    maxHeight: 100,
    color: '#fff',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 15,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
