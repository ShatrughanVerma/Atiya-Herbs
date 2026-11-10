import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {fetchMyVideos, sendVideoFile, startVideoUpload} from '../services/doctorApi';
import useKeyboardHeight from '../utils/useKeyboardHeight';
import {formatBytes, formatDuration} from '../utils/doctor';
import {pickVideoFromGallery} from './pickVideo';
import {colors, spacing} from '../theme';

const STATUS_TEXT = {uploading: 'Not finished', uploaded: 'Uploaded', failed: 'Failed', archived: 'Archived'};
const PATIENT_ID = /^P\d{1,9}$/;

// The upload form of the doctor. It has two required fields, the Patient ID (like P000123) and the Doctor ID (the
// doctor's own, filled in and locked), then the video from the gallery and the patient's agreement. No visit is involved.
export default function VideoUploadForm({doctorId, onClose}) {
  const keyboard = useKeyboardHeight();
  // the phone's own navigation buttons must not cover the Close and Upload buttons
  const insets = useSafeAreaInsets();
  const [patientId, setPatientId] = useState('');
  const [touched, setTouched] = useState(false);
  const [picked, setPicked] = useState(null); // {uri, type, name, size, duration}
  const [consent, setConsent] = useState(false);
  const [progress, setProgress] = useState(null); // null = not uploading, 0..1
  const [videos, setVideos] = useState([]);
  const [listState, setListState] = useState('loading');
  const uploading = progress !== null;
  const patientOk = PATIENT_ID.test(patientId);

  const loadVideos = useCallback(async () => {
    try {
      setVideos(await fetchMyVideos());
      setListState('ready');
    } catch {
      setListState('error');
    }
  }, []);

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
    setTouched(true);
    if (!patientOk || !picked || !consent) {
      return;
    }
    setProgress(0);
    try {
      const started = await startVideoUpload({patientId, doctorId, mimeType: picked.type, sizeBytes: picked.size, durationSec: picked.duration});
      await sendVideoFile(started.id, {uri: picked.uri, type: picked.type, name: picked.name}, setProgress);
      Alert.alert('Video', `The video ${started.code} is uploaded and saved for patient ${patientId}.`);
      setPicked(null);
      setConsent(false);
      setPatientId('');
      setTouched(false);
    } catch (error) {
      Alert.alert('Video', error.message);
    } finally {
      setProgress(null);
      loadVideos();
    }
  };

  const canUpload = !!picked && consent && patientOk && !uploading;

  return (
    <Modal transparent animationType="slide" onRequestClose={uploading ? undefined : onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, {marginBottom: keyboard, paddingBottom: spacing.md + (keyboard > 0 ? 0 : insets.bottom)}]}>
          <Text style={styles.title}>Upload Consultation Video</Text>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Doctor ID</Text>
            <View style={[styles.input, styles.locked]}>
              <Text style={styles.lockedText}>{doctorId}</Text>
              <Icon name="lock-outline" size={18} color={colors.muted} />
            </View>

            <Text style={styles.label}>Patient ID *</Text>
            <TextInput
              style={[styles.input, touched && !patientOk && styles.inputBad]}
              value={patientId}
              onChangeText={text => setPatientId(text.toUpperCase().replace(/[^P0-9]/g, '').slice(0, 10))}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="e.g. P000123"
              placeholderTextColor="#9AA3AF"
              editable={!uploading}
              accessibilityLabel="Patient ID"
            />
            {touched && !patientOk && <Text style={styles.error}>Enter the patient ID like P000123.</Text>}

            <Text style={styles.label}>Video *</Text>
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
              <Pressable style={[styles.chooseBtn, touched && !picked && styles.chooseBad]} onPress={choose} accessibilityRole="button">
                <Icon name="image-multiple-outline" size={20} color={colors.primaryDark} />
                <Text style={styles.chooseText}>Choose video from gallery</Text>
              </Pressable>
            )}
            {touched && !picked && <Text style={styles.error}>Choose the video to upload.</Text>}

            <Pressable style={styles.consentRow} onPress={() => !uploading && setConsent(on => !on)} accessibilityRole="checkbox" accessibilityState={{checked: consent}}>
              <View style={[styles.checkbox, consent && styles.checkboxOn]}>{consent && <Icon name="check" size={18} color="#fff" />}</View>
              <Text style={styles.consentText}>The patient has agreed to this video being recorded and saved.</Text>
            </Pressable>
            {touched && !consent && <Text style={styles.error}>The patient must agree to the recording.</Text>}

            {uploading && (
              <View style={styles.progressBox}>
                <View style={styles.track}>
                  <View style={[styles.fill, {width: `${Math.round(progress * 100)}%`}]} />
                </View>
                <Text style={styles.muted}>Uploading {Math.round(progress * 100)}% - please keep the app open.</Text>
              </View>
            )}

            <Text style={styles.listTitle}>Your videos</Text>
            {listState === 'loading' ? (
              <ActivityIndicator color={colors.primary} style={styles.loading} />
            ) : listState === 'error' ? (
              <Text style={styles.error}>Could not load the list.</Text>
            ) : videos.length === 0 ? (
              <Text style={styles.muted}>No video yet.</Text>
            ) : (
              videos.slice(0, 5).map(v => (
                <View key={v.id} style={styles.item}>
                  <Icon name={v.status === 'uploaded' ? 'check-circle' : v.status === 'failed' ? 'alert-circle' : 'progress-clock'} size={20} color={v.status === 'uploaded' ? colors.primary : v.status === 'failed' ? colors.danger : colors.accent} />
                  <View style={styles.itemText}>
                    <Text style={styles.itemTitle}>
                      {v.code} · {STATUS_TEXT[v.status] ?? v.status}
                    </Text>
                    <Text style={styles.muted} numberOfLines={2}>
                      {[v.patientCode, v.patientName, formatBytes(v.sizeBytes), formatDuration(v.durationSec), v.status === 'failed' ? v.failedReason : ''].filter(Boolean).join(' · ')}
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
            <Pressable style={[styles.btn, styles.btnFill, !canUpload && styles.disabled]} onPress={send} disabled={uploading} accessibilityRole="button">
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
  sheet: {backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.md, maxHeight: '92%'},
  title: {fontSize: 20, fontWeight: '800', color: colors.text},
  muted: {color: colors.muted, marginTop: 2, fontSize: 13},
  body: {marginTop: 4},
  label: {color: colors.muted, marginTop: 14, marginBottom: 6, marginLeft: 4, fontSize: 13},
  input: {backgroundColor: colors.card, borderRadius: 16, paddingHorizontal: 14, minHeight: 48, color: colors.text, fontSize: 16},
  inputBad: {borderWidth: 1, borderColor: colors.danger},
  locked: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  lockedText: {color: colors.muted, fontSize: 16},
  error: {color: colors.danger, marginTop: 4, marginLeft: 4, fontSize: 13},
  chooseBtn: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 50, borderRadius: 25, backgroundColor: colors.primaryLight},
  chooseBad: {borderWidth: 1, borderColor: colors.danger},
  chooseText: {color: colors.primaryDark, fontWeight: '700', marginLeft: 8},
  file: {flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 14, padding: 12},
  fileText: {flex: 1, marginHorizontal: 12},
  fileName: {fontWeight: '700', color: colors.text},
  consentRow: {flexDirection: 'row', alignItems: 'center', marginTop: 18},
  checkbox: {width: 30, height: 30, borderRadius: 8, borderWidth: 2, borderColor: colors.muted, alignItems: 'center', justifyContent: 'center'},
  checkboxOn: {backgroundColor: colors.primaryDark, borderColor: colors.primaryDark},
  consentText: {flex: 1, marginLeft: 12, color: colors.text, fontSize: 15, lineHeight: 21},
  progressBox: {marginTop: 14},
  track: {height: 10, borderRadius: 5, backgroundColor: colors.border, overflow: 'hidden', marginBottom: 6},
  fill: {height: 10, backgroundColor: colors.primary},
  listTitle: {fontWeight: '800', color: colors.text, marginTop: 22, marginBottom: 8},
  loading: {alignSelf: 'flex-start'},
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
