import { request } from './http';
import { authFetch } from './session';

// Doctor consultation endpoints of the backend. Looking at clinics, doctors and free slots is public;
// booking and the person's own appointments need a login.

const query = params => {
  const pairs = Object.entries(params || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  return pairs.length ? `?${pairs.join('&')}` : '';
};

// -> [{id, name, city, ..., distanceKm?}]
export const fetchClinics = ({ city, q, lat, lng } = {}) =>
  request(`/clinics${query({ city, q, lat, lng })}`);
export const fetchClinic = id => request(`/clinics/${encodeURIComponent(id)}`);

// -> {items, total, page, pageSize}
export const fetchDoctors = ({
  q,
  specialization,
  concern,
  mode,
  clinicId,
  maxFee,
  minRating,
  page = 1,
  pageSize = 50,
} = {}) =>
  request(
    `/doctors${query({ q, specialization, concern, mode, clinicId, maxFee, minRating, page, pageSize })}`,
  );
// -> ['General Wellness', 'Gut Health', ...] the filter chips, most common first
export const fetchConcerns = () => request('/doctors/concerns');
export const fetchDoctor = id => request(`/doctors/${encodeURIComponent(id)}`);
// date: 'YYYY-MM-DD' (Indian date) -> {doctorId, date, slots: [{startsAt, endsAt}]}
export const fetchSlots = (doctorId, date) =>
  request(`/doctors/${encodeURIComponent(doctorId)}/slots${query({ date })}`);

// type: 'text' | 'audio' | 'video' | 'clinic'; startsAt: one of the times from fetchSlots
// Without startsAt the request waits for the clinic to suggest a time (preferredDate is only a wish).
export const bookAppointment = ({
  doctorId,
  type,
  startsAt,
  preferredDate,
  forSelf = true,
  patientName,
  patientMobile,
  city,
  concern,
  duration,
  reason,
  useCredits = false,
}) =>
  authFetch('/appointments', {
    method: 'POST',
    body: {
      doctorId,
      type,
      forSelf,
      useCredits,
      ...(startsAt && { startsAt }),
      ...(preferredDate && { preferredDate }),
      ...(patientName && { patientName }),
      ...(patientMobile && { patientMobile }),
      ...(city && { city }),
      ...(concern && { concern }),
      ...(duration && { duration }),
      ...(reason && { reason }),
    },
  });
// -> {balance, history: [{delta, reason, at}]}
export const fetchCredits = () => authFetch('/credits');
export const listAppointments = (page = 1, pageSize = 30) =>
  authFetch(`/appointments${query({ page, pageSize })}`);
export const cancelAppointment = id =>
  authFetch(`/appointments/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
