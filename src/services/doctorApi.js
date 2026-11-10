import { authFetch, authUpload } from './session';

// The doctor's own side of the backend (/doctor/...). It needs a login with the Doctor role; the server finds
// the doctor from the login, so nothing here names a doctor.

const query = params => {
  const pairs = Object.entries(params || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  return pairs.length ? `?${pairs.join('&')}` : '';
};

// -> {id, name, system, specialization, photoUrl, clinicId, clinicName, fee}
export const fetchDoctorMe = () => authFetch('/doctor/me');
// -> {requestedAppointments, todayAppointments, upcomingAppointments, cancelledLast7Days, patients}
export const fetchDoctorDashboard = () => authFetch('/doctor/dashboard');

// status: 'requested' | 'booked' | 'completed' | 'cancelled'; date: 'YYYY-MM-DD' -> {items, total, page, pageSize}
export const fetchDoctorAppointments = ({ status, date, q, page = 1, pageSize = 30 } = {}) =>
  authFetch(`/doctor/appointments${query({ status, date, q, page, pageSize })}`);

// Without startsAt the time the patient chose is kept; it is needed when the patient gave none
export const confirmAppointmentAsDoctor = (id, startsAt) =>
  authFetch(`/doctor/appointments/${encodeURIComponent(id)}/confirm`, {
    method: 'POST',
    body: startsAt ? { startsAt } : {},
  });
export const declineAppointment = (id, reason) =>
  authFetch(`/doctor/appointments/${encodeURIComponent(id)}/decline`, {
    method: 'POST',
    body: reason ? { reason } : {},
  });
export const completeAppointmentAsDoctor = id =>
  authFetch(`/doctor/appointments/${encodeURIComponent(id)}/complete`, { method: 'POST' });

// -> {items: [{name, mobile, city, visits, requests, lastVisit, lastConcern}], total, page, pageSize}
export const fetchDoctorPatients = ({ q, page = 1, pageSize = 50 } = {}) =>
  authFetch(`/doctor/patients${query({ q, page, pageSize })}`);

// -> {timings: [{weekday, startTime, endTime, slotMinutes}]}
export const fetchDoctorSchedule = () => authFetch('/doctor/schedule');
export const saveDoctorSchedule = timings =>
  authFetch('/doctor/schedule', { method: 'PUT', body: { timings } });

// ---- videos of a visit. The doctor makes the video with the phone's own camera app, then sends it from here.
// Step 1: the form of the doctor: the patient id (P000123), the doctor id (their own), the file that is coming and that the
// patient agreed -> {id, code: 'V000012', status: 'uploading', maxBytes}. No visit is involved.
export const startVideoUpload = ({ patientId, doctorId, mimeType, sizeBytes, durationSec }) =>
  authFetch('/doctor/videos', {
    method: 'POST',
    body: {
      patientId,
      doctorId,
      mimeType,
      consent: true,
      ...(sizeBytes && { sizeBytes }),
      ...(durationSec && { durationSec: Math.round(durationSec) }),
    },
  });
// Step 2: send the file. file = {uri, type, name}; onProgress gets 0..1
export function sendVideoFile(videoId, file, onProgress) {
  const form = new FormData();
  form.append('file', { uri: file.uri, type: file.type, name: file.name });
  return authUpload(`/doctor/videos/${encodeURIComponent(videoId)}/file`, form, onProgress);
}

// The doctor's own videos, newest first:
// [{id, code: 'V000012', status, patientName, patientMobile, patientCode: 'P000123', sizeBytes, durationSec, ...}]
// Smart search: q is a video id (V000012), a patient id (P000123), a mobile number or a name;
// status is 'uploaded' | 'failed' | 'uploading'
export const fetchMyVideos = ({ q, status } = {}) => authFetch(`/doctor/videos${query({ q, status })}`);
// A link that plays one of the doctor's own videos for an hour -> {path, expiresAt}
export const getVideoPlayLink = videoId =>
  authFetch(`/doctor/videos/${encodeURIComponent(videoId)}/link`, { method: 'POST', body: { action: 'play' } });

