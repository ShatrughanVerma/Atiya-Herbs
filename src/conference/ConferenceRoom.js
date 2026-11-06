import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
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
import Avatar from '../calling/Avatar';
import CallVideo from '../calling/CallVideo';
import AddPersonCard from '../meetings/AddPersonCard';
import { callMetrics } from '../calling/CallOverlay';
import { CONFERENCE_ADD_ERRORS, useConference } from './ConferenceContext';
import {
  MAX_TILES,
  formatTimer,
  gridMetrics,
  orderTiles,
  pickStage,
} from '../meetings/meetingLayout';

// The conference call screen, shown above every screen while you are in a group call. It looks like the one-to-one
// call screen (src/calling/CallOverlay.js): minimize on the left, add a person on the right, labelled buttons in a
// grid of three at the bottom, and everybody's video above them. With 3 or more people on a tall screen one person
// fills the stage and the rest sit in a row under it; with up to 100 people only the first few have a tile and the
// rest are in the People list (tap "+N" or the people count).

const BG = '#0B141A';
const PANEL = '#1F2C34';
const GREEN = '#25D366';
const RED = '#F15C6D';
const ORANGE = '#FF8D2F';

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

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

function Control({ icon, label, text, onPress, size, cell, active = false }) {
  return (
    <View style={[styles.control, { width: cell }]}>
      <Pressable
        onPress={onPress}
        style={[
          styles.controlBtn,
          { width: size, height: size, borderRadius: size / 2 },
          active && styles.controlBtnActive,
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
      <Text style={styles.controlLabel} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

function Tile({ person, width, height, frontCamera }) {
  const showVideo = person.videoOn && person.uid !== undefined;
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
        </View>
      )}
      <View style={styles.tileLabel}>
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

// Everybody in the call (a long list, so it is a FlatList that draws only what is on screen), then the people being rung
function PeoplePanel({ onClose, onAddPerson }) {
  const { people, invited, cancelInvite } = useConference();
  const myId = people.find(p => p.isMe)?.id;
  return (
    <View style={styles.sheet}>
      <View style={styles.sheetHead}>
        <Text style={styles.sheetTitle}>People ({people.length})</Text>
        <Pressable onPress={onClose} accessibilityLabel="Close people">
          <Icon name="close" size={24} color="#fff" />
        </Pressable>
      </View>
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
      <FlatList
        data={people}
        keyExtractor={p => p.id}
        initialNumToRender={12}
        windowSize={7}
        ListHeaderComponent={
          <View>
            {invited.map(i => (
              <View key={i.id} style={styles.personRow}>
                <Avatar name={i.name} size={38} />
                <View style={styles.personInfo}>
                  <Text style={styles.personName} numberOfLines={1}>
                    {i.name}
                  </Text>
                  <Text style={styles.personNote}>Ringing…</Text>
                </View>
                {i.by === myId && (
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
            ))}
          </View>
        }
        renderItem={({ item: p }) => (
          <View style={styles.personRow}>
            <Avatar name={p.name} size={38} />
            <View style={styles.personInfo}>
              <Text style={styles.personName} numberOfLines={1}>
                {p.name}
                {p.isMe ? ' (you)' : ''}
              </Text>
              {!!p.offline && (
                <Text style={styles.personNote}>reconnecting</Text>
              )}
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
          </View>
        )}
      />
    </View>
  );
}

export default function ConferenceRoom() {
  const {
    status,
    conference,
    people,
    muted,
    cameraOn,
    speakerOn,
    frontCamera,
    connection,
    notice,
    leaveConference,
    toggleMute,
    toggleCamera,
    flipCamera,
    toggleSpeaker,
    inviteByNumber,
    setVisibleAccounts,
  } = useConference();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [adding, setAdding] = useState(false); // the "add someone by number" card
  const [minimized, setMinimized] = useState(false); // shrunk to a bar so the app can be used
  const [pinnedId, setPinnedId] = useState(null); // the person you tapped to have on the big tile
  const [area, setArea] = useState({
    width: window.width,
    height: window.height - 320,
  });
  const timer = useTimer(conference?.startedAt);
  const conferenceId = conference?.id;

  useEffect(() => {
    setMinimized(false);
    setPinnedId(null);
    setPeopleOpen(false);
    setAdding(false);
  }, [conferenceId]);

  const speakingId = people.find(p => p.speaking)?.id;
  const myId = people.find(p => p.isMe)?.id;
  const ordered = useMemo(
    () => orderTiles(people, { myId, speakingId }),
    [people, myId, speakingId],
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
    ? pickStage(tiles, { pinnedId, speakingId })
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
          <Text style={styles.joiningText}>Joining the group call…</Text>
        </View>
      </Modal>
    );
  }

  const subtitle = `${people.length} ${
    people.length === 1 ? 'person' : 'people'
  } · ${timer}`;

  if (minimized) {
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
            Group call · {timer} · {people.length}
          </Text>
          <Text style={styles.miniTap}>Tap to return</Text>
        </Pressable>
      </View>
    );
  }

  const m = callMetrics({
    width: window.width,
    height: window.height,
    insets,
  });
  const cell = Math.floor((m.contentWidth - 40) / 3);
  const btn = clamp(cell - 28, 48, 68);

  return (
    <Modal
      visible
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => setMinimized(true)}
    >
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      {/* Inside a Modal the safe-area insets are not passed down, so the buttons would sit under the nav bar */}
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: window.width, height: window.height },
          insets: { top: 0, left: 0, right: 0, bottom: 0, ...insets },
        }}
      >
        <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
          <View style={styles.topBar}>
            <Pressable
              style={styles.topBtn}
              onPress={() => setMinimized(true)}
              accessibilityRole="button"
              accessibilityLabel="Minimize call"
            >
              <Icon name="arrow-collapse" size={22} color="#fff" />
            </Pressable>
            <Pressable
              style={styles.topInfo}
              onPress={() => setPeopleOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="People in the call"
            >
              <Text
                style={styles.title}
                numberOfLines={1}
                maxFontSizeMultiplier={1.2}
              >
                Group call
              </Text>
              <Text style={styles.subtitle} maxFontSizeMultiplier={1.2}>
                {subtitle}
              </Text>
            </Pressable>
            <Pressable
              style={styles.topBtn}
              onPress={() => setAdding(true)}
              accessibilityRole="button"
              accessibilityLabel="Add person"
            >
              <Icon name="account-plus" size={22} color="#fff" />
            </Pressable>
          </View>

          {(connection === 'reconnecting' || notice) && (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>
                {connection === 'reconnecting' ? 'Reconnecting…' : notice}
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
                  />
                </Pressable>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: grid.gap }}
                  accessibilityLabel="Everyone else in the call"
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
                      />
                    </Pressable>
                  ))}
                  {extra > 0 && (
                    <MoreTile
                      count={extra + 1}
                      width={grid.tileWidth}
                      height={grid.tileHeight}
                      onPress={() => setPeopleOpen(true)}
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
                  />
                ))}
                {extra > 0 && (
                  <MoreTile
                    count={extra + 1}
                    width={grid.tileWidth}
                    height={grid.tileHeight}
                    onPress={() => setPeopleOpen(true)}
                  />
                )}
              </View>
            )}
          </View>

          <View style={[styles.panel, { paddingBottom: m.panelBottom }]}>
            <View style={styles.handle} />
            <View style={[styles.controls, { width: m.contentWidth - 40 }]}>
              <Control
                icon="volume-high"
                label="Speaker"
                text="Speaker"
                size={btn}
                cell={cell}
                active={speakerOn}
                onPress={toggleSpeaker}
              />
              <Control
                icon={cameraOn ? 'video' : 'video-off'}
                label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
                text="Video"
                size={btn}
                cell={cell}
                active={cameraOn}
                onPress={toggleCamera}
              />
              <Control
                icon={muted ? 'microphone-off' : 'microphone'}
                label={muted ? 'Unmute' : 'Mute'}
                text={muted ? 'Unmute' : 'Mute'}
                size={btn}
                cell={cell}
                active={muted}
                onPress={toggleMute}
              />
              {cameraOn && (
                <Control
                  icon="camera-flip-outline"
                  label="Switch camera"
                  text="Flip"
                  size={btn}
                  cell={cell}
                  onPress={flipCamera}
                />
              )}
              <View style={[styles.control, { width: cell }]}>
                <Pressable
                  onPress={leaveConference}
                  style={[
                    styles.endBtn,
                    { width: btn, height: btn, borderRadius: btn / 2 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Leave call"
                >
                  <Icon
                    name="phone-hangup"
                    size={Math.round(btn * 0.46)}
                    color="#fff"
                  />
                </Pressable>
                <Text style={styles.controlLabel}>End</Text>
              </View>
            </View>
          </View>

          {peopleOpen && (
            <PeoplePanel
              onClose={() => setPeopleOpen(false)}
              onAddPerson={() => setAdding(true)}
            />
          )}
          {adding && (
            <AddPersonCard
              title="Add someone to this call"
              note="Their phone rings, and they join when they accept."
              errors={CONFERENCE_ADD_ERRORS}
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
    paddingTop: 8,
    paddingBottom: 6,
  },
  topBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  topInfo: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  title: { color: '#fff', fontSize: 18, fontWeight: '600' },
  subtitle: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 2 },
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
  moreText: { color: '#fff', fontSize: 28, fontWeight: '700' },
  moreNote: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  panel: {
    backgroundColor: PANEL,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 10,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginBottom: 18,
  },
  controls: { flexDirection: 'row', flexWrap: 'wrap' },
  control: { alignItems: 'center', marginBottom: 14 },
  controlBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  controlBtnActive: { backgroundColor: '#fff' },
  controlLabel: { color: '#fff', fontSize: 13, marginTop: 6 },
  endBtn: {
    backgroundColor: RED,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  personInfo: { flex: 1, marginLeft: 12 },
  personName: { color: '#fff', fontSize: 15 },
  personNote: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  personIcon: { marginLeft: 12 },
});
