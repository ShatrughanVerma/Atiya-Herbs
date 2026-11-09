import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {fetchAppointmentVideos, sendVideoFile, startVideoUpload} from '../services/doctorApi';
import {formatDay, formatTime} from '../utils/consult';
import {formatBytes, formatDuration} from '../utils/doctor';
import {pickVideoFromGallery} from './pickVideo';
import {colors, spacing} from '../theme';

const STATUS_TEXT = {uploading: 'Not finished', uploaded: 'Uploaded', failed: 'Failed', archived: 'Archived'};

// The doctor records the visit with the phone's own camera app, then sends the video from here. The gallery was
// already opened by the button, so the video is usually chosen when this opens (`video`):
//   1. tick that the patient agreed  2. Upload  (with a progress bar)
export default function VideoUploadSheet({appointment, video, onClose}) {
  const [consent, setConsent] = useState(false);
  const [picked, setPicked] = useState(video ?? null); // {uri, type, name, size, duration}
  const [progress, setProgress] = useState(null); // null = not uploading, 0..1
  const [videos, setVideos] = useState([]);
  const [listState, setListState] = useState('loading');
  const uploading = progress !== null;

  const loadVideos = useCallback(async () => {
    try {
      setVideos(await fetchAppointmentVideos(appointment.id));
      setListState('ready');
    } catch {
      setListState('error');
    }
  }, [appointment.id]);

  useEffect(() => {
    loadVideos();
  }, [loadVideos]);

  const choose = async () => {
    const chosen = await pickVideoFromGallery();
    if (chosen) {
      setPicked(chosen);
    }
  };

  const send = async () => {
    setProgress(0);
    try {
      const started = await startVideoUpload(appointment.id, {mimeType: picked.type, sizeBytes: picked.size, durationSec: picked.duration});
      await sendVideoFile(started.id, {uri: picked.uri, type: picked.type, name: picked.name}, setProgress);
      setPicked(null);
      setConsent(false);
      Alert.alert('Video', 'The video is uploaded and saved with this appointment.');
    } catch (error) {
      Alert.alert('Video', error.message);
    } finally {
      setProgress(null);
      loadVideos();
    }
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={uploading ? undefined : onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Visit video</Text>
          <Text style={styles.muted}>
            {appointment.patientName}
            {appointment.startsAt ? ` · ${formatDay(appointment.startsAt)}, ${formatTime(appointment.startsAt)}` : ''}
          </Text>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.help}>Record the visit with your phone&apos;s camera app first. Then choose that video here.</Text>

            <Pressable style={styles.consentRow} onPress={() => !uploading && setConsent(on => !on)} accessibilityRole="checkbox" accessibilityState={{checked: consent}}>
              <View style={[styles.checkbox, consent && styles.checkboxOn]}>{consent && <Icon name="check" size={18} color="#fff" />}</View>
              <Text style={styles.consentText}>The patient has agreed to this video being recorded and saved.</Text>
            </Pressable>

            {picked ? (
              <View style={styles.file}>
                <Icon name="video-outline" size={28} color={colors.primary} />
                <View style={styles.fileText}>
                  <Text style={styles.fileName} numberOfLines={1}>
                    {picked.name}
                  </Text>
                  <Text style={styles.muted}>{[formatBytes(picked.size), formatDuration(picked.duration)].filter(Boolean).join(' · ')}</Text>
                </View>
                {!uploading && (
                  <Pressable onPress={() => setPicked(null)} hitSlop={8} accessibilityLabel="Remove the chosen video">
                    <Icon name="close-circle-outline" size={24} color={colors.muted} />
                  </Pressable>
                )}
              </View>
            ) : (
              <Pressable style={[styles.chooseBtn, !consent && styles.disabled]} disabled={!consent} onPress={choose} accessibilityRole="button">
                <Icon name="image-multiple-outline" size={20} color={colors.primaryDark} />
                <Text style={styles.chooseText}>Choose video from gallery</Text>
              </Pressable>
            )}

            {uploading && (
              <View style={styles.progressBox}>
                <View style={styles.track}>
                  <View style={[styles.fill, {width: `${Math.round(progress * 100)}%`}]} />
                </View>
                <Text style={styles.muted}>Uploading {Math.round(progress * 100)}% - please keep the app open.</Text>
              </View>
            )}

            <Text style={styles.listTitle}>Videos of this visit</Text>
            {listState === 'loading' ? (
              <ActivityIndicator color={colors.primary} style={styles.loading} />
            ) : listState === 'error' ? (
              <Text style={styles.error}>Could not load the list.</Text>
            ) : videos.length === 0 ? (
              <Text style={styles.muted}>No video yet.</Text>
            ) : (
              videos.map(v => (
                <View key={v.id} style={styles.item}>
                  <Icon name={v.status === 'uploaded' ? 'check-circle' : v.status === 'failed' ? 'alert-circle' : 'progress-clock'} size={20} color={v.status === 'uploaded' ? colors.primary : v.status === 'failed' ? colors.danger : colors.accent} />
                  <View style={styles.itemText}>
                    <Text style={styles.itemTitle}>{STATUS_TEXT[v.status] ?? v.status}</Text>
                    <Text style={styles.muted} numberOfLines={2}>
                      {[formatBytes(v.sizeBytes), formatDuration(v.durationSec), v.status === 'failed' ? v.failedReason : ''].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>

          <View style={styles.buttons}>
            <Pressable style={[styles.btn, styles.btnOutline, uploading && styles.disabled]} disabled={uploading} onPress={onClose} accessibilityRole="button">
              <Text style={styles.btnOutlineText}>Close</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnFill, (!picked || !consent || uploading) && styles.disabled]} disabled={!picked || !consent || uploading} onPress={send} accessibilityRole="button">
              <Text style={styles.btnFillText}>{uploading ? 'Uploading…' : 'Upload'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end'},
  sheet: {backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.md, maxHeight: '90%'},
  title: {fontSize: 20, fontWeight: '800', color: colors.text},
  muted: {color: colors.muted, marginTop: 2, fontSize: 13},
  body: {marginTop: 8},
  help: {color: colors.text, lineHeight: 20, marginTop: 6},
  consentRow: {flexDirection: 'row', alignItems: 'center', marginTop: 16},
  checkbox: {width: 30, height: 30, borderRadius: 8, borderWidth: 2, borderColor: colors.muted, alignItems: 'center', justifyContent: 'center'},
  checkboxOn: {backgroundColor: colors.primaryDark, borderColor: colors.primaryDark},
  consentText: {flex: 1, marginLeft: 12, color: colors.text, fontSize: 15, lineHeight: 21},
  chooseBtn: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 50, borderRadius: 25, backgroundColor: colors.primaryLight, marginTop: 16},
  chooseText: {color: colors.primaryDark, fontWeight: '700', marginLeft: 8},
  file: {flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 14, padding: 12, marginTop: 16},
  fileText: {flex: 1, marginHorizontal: 12},
  fileName: {fontWeight: '700', color: colors.text},
  progressBox: {marginTop: 14},
  track: {height: 10, borderRadius: 5, backgroundColor: colors.border, overflow: 'hidden', marginBottom: 6},
  fill: {height: 10, backgroundColor: colors.primary},
  listTitle: {fontWeight: '800', color: colors.text, marginTop: 22, marginBottom: 8},
  loading: {alignSelf: 'flex-start'},
  error: {color: colors.danger},
  item: {flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border},
  itemText: {flex: 1, marginLeft: 10},
  itemTitle: {fontWeight: '700', color: colors.text},
  buttons: {flexDirection: 'row', marginTop: 14},
  btn: {flex: 1, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center'},
  btnOutline: {borderWidth: 1.5, borderColor: colors.primaryDark, marginRight: 10, backgroundColor: '#fff'},
  btnOutlineText: {color: colors.primaryDark, fontWeight: '700'},
  btnFill: {backgroundColor: colors.primaryDark},
  btnFillText: {color: '#fff', fontWeight: '700'},
  disabled: {opacity: 0.45},
});
