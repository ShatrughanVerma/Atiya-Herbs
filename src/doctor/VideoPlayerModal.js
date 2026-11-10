import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, AppState, Modal, Pressable, StatusBar, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Video from 'react-native-video';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {API_BASE_URL} from '../config/api';
import {getVideoPlayLink} from '../services/doctorApi';
import {originOf} from '../utils/doctor';
import {clearVideoPosition, loadVideoPosition, saveVideoPosition} from '../utils/videoResume';
import {colors, spacing} from '../theme';

// Plays one of the doctor's own videos inside the app. The server gives a link that works for an hour and is made for
// this one video; the player streams from it (play, pause, seek). If the link ever runs out (a very long pause), a new
// one is asked for and the video carries on from the same second. The place where the doctor stopped is remembered on the
// phone: opening the same video later (even after the app was closed) carries on from there, not from the start.
export default function VideoPlayerModal({video, onClose}) {
  // the phone's own bars (status bar on top, navigation buttons at the bottom) must not cover the video or its controls
  const insets = useSafeAreaInsets();
  const [source, setSource] = useState(null); // {uri}
  const [state, setState] = useState('loading'); // loading | ready | error
  const [message, setMessage] = useState('');
  const playerRef = useRef(null);
  const position = useRef(0); // the second the video was at
  const resumeAt = useRef(0);
  const askedAt = useRef(0);
  const savedAt = useRef(0); // the second that was last written to the phone

  const loadLink = useCallback(async () => {
    try {
      const {path} = await getVideoPlayLink(video.id);
      askedAt.current = Date.now();
      setSource({uri: `${originOf(API_BASE_URL)}${path}`});
    } catch (error) {
      setMessage(error.message || 'Could not open the video.');
      setState('error');
    }
  }, [video.id]);

  useEffect(() => {
    loadLink();
  }, [loadLink]);

  // closing the video keeps its place
  const close = () => {
    saveVideoPosition(video.id, position.current);
    onClose();
  };
  useEffect(
    () => () => {
      saveVideoPosition(video.id, position.current);
    },
    [video.id],
  );

  // the app goes to the background (home button, another app): keep the place, in case the phone closes the app
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      if (next !== 'active') {
        saveVideoPosition(video.id, position.current);
      }
    });
    return () => subscription.remove();
  }, [video.id]);

  // an error after a while is most likely the link that ran out: ask for a new one and go back to where we were
  const onError = () => {
    if (Date.now() - askedAt.current < 3000) {
      setMessage('The video could not be played. Please try again.');
      setState('error');
      return;
    }
    resumeAt.current = position.current;
    setState('loading');
    loadLink();
  };

  return (
    <Modal animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={[styles.screen, {paddingBottom: insets.bottom}]}>
        <StatusBar backgroundColor="#000" barStyle="light-content" />
        <View style={[styles.bar, {paddingTop: insets.top + 8}]}>
          <Pressable style={styles.close} onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close the video">
            <Icon name="close" size={26} color="#fff" />
          </Pressable>
          <View style={styles.title}>
            <Text style={styles.code}>{video.code}</Text>
            <Text style={styles.sub} numberOfLines={1}>
              {[video.patientName, video.patientCode].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>

        <View style={styles.stage}>
          {!!source && state !== 'error' && (
            <Video
              ref={playerRef}
              source={source}
              style={styles.video}
              controls
              resizeMode="contain"
              paused={false}
              onLoad={async event => {
                setState('ready');
                // after a new link: the second we were at; the first time: the place saved on this phone
                const target = resumeAt.current > 0 ? resumeAt.current : await loadVideoPosition(video.id, event?.duration);
                resumeAt.current = 0;
                if (target > 0) {
                  playerRef.current?.seek(target);
                  position.current = target;
                }
              }}
              onProgress={event => {
                position.current = event.currentTime;
                // keep the place on the phone every few seconds (so it survives closing the app while paused)
                if (Math.abs(event.currentTime - savedAt.current) >= 3) {
                  savedAt.current = event.currentTime;
                  saveVideoPosition(video.id, event.currentTime);
                }
              }}
              onEnd={() => {
                position.current = 0;
                savedAt.current = 0;
                clearVideoPosition(video.id);
              }}
              onError={onError}
            />
          )}
          {state === 'loading' && <ActivityIndicator color="#fff" size="large" style={styles.loading} />}
          {state === 'error' && (
            <View style={styles.error}>
              <Icon name="video-off-outline" size={48} color="#fff" />
              <Text style={styles.errorText}>{message}</Text>
              <Pressable
                style={styles.retry}
                onPress={() => {
                  setState('loading');
                  loadLink();
                }}
                accessibilityRole="button">
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: '#000'},
  bar: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingBottom: 8},
  close: {width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center'},
  title: {flex: 1, marginLeft: 12},
  code: {color: '#fff', fontWeight: '800', fontSize: 17},
  sub: {color: '#C9D1D9', fontSize: 13, marginTop: 2},
  stage: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  video: {width: '100%', height: '100%'},
  loading: {position: 'absolute'},
  error: {alignItems: 'center', padding: spacing.lg},
  errorText: {color: '#fff', textAlign: 'center', marginTop: 12, lineHeight: 20},
  retry: {marginTop: 16, backgroundColor: colors.primary, borderRadius: 22, paddingHorizontal: 24, height: 44, alignItems: 'center', justifyContent: 'center'},
  retryText: {color: '#fff', fontWeight: '700'},
});
