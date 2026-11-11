import axios from 'axios';
import { API_BASE_URL, API_TIMEOUT_MS } from '../config/api';

// One axios instance for every call to the API. validateStatus is open so that our own code (fromResponse) turns a
// 4xx / 5xx answer into an ApiError with the message written for the person. Tests replace its adapter (see
// test-utils/mockServer).
export const client = axios.create({ baseURL: API_BASE_URL, validateStatus: () => true });

// a failed axios call (no answer at all) is either a timeout or no connection
const fromAxiosFailure = error =>
  new ApiError(
    error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT' ? 'timeout' : 'network',
    FALLBACK[error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT' ? 'timeout' : 'network'],
  );

// One error type for everything that goes wrong when talking to the API.
//  kind: 'network' | 'timeout' | 'validation' | 'unauthorized' | 'forbidden' | 'not-found' | 'conflict'
//        | 'rate-limited' | 'server'
//  fields: {fieldName: message} for validation errors, so a form can show them under the right box
//  retryAfter: seconds to wait, when the server says so (429)
export class ApiError extends Error {
  constructor(kind, message, { status = 0, fields = {}, retryAfter = 0 } = {}) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.fields = fields;
    this.retryAfter = retryAfter;
  }
}

const KIND_BY_STATUS = {
  400: 'validation',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not-found',
  409: 'conflict',
  429: 'rate-limited',
};

const FALLBACK = {
  network: 'Cannot reach the server. Please check your internet and try again.',
  timeout: 'The server is taking too long. Please try again.',
  validation: 'Some details are not valid.',
  unauthorized: 'Your session has expired. Please log in again.',
  forbidden: 'This is not allowed.',
  'not-found': 'Not found.',
  conflict: 'This could not be done right now.',
  'rate-limited': 'Too many tries. Please wait a few minutes and try again.',
  server: 'Something went wrong on our side. Please try again.',
};

// The backend's messages for 4xx answers are written to be shown to the person; 5xx and network problems
// always get our own text.
const fromResponse = (status, body, retryAfterHeader) => {
  const kind = KIND_BY_STATUS[status] || 'server';
  const text =
    typeof body?.message === 'string' && body.message && kind !== 'server'
      ? body.message
      : FALLBACK[kind];
  const fields = {};
  if (Array.isArray(body?.details)) {
    for (const d of body.details) {
      if (
        d &&
        typeof d.field === 'string' &&
        typeof d.message === 'string' &&
        !fields[d.field]
      ) {
        fields[d.field] = d.message;
      }
    }
  }
  const retryAfter = Number(retryAfterHeader);
  return new ApiError(kind, text, {
    status,
    fields,
    retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 0,
  });
};

// request('/path', {method, body, token}) -> parsed JSON (or null for 204). Throws ApiError.
export async function request(
  path,
  { method = 'GET', body, token, timeoutMs = API_TIMEOUT_MS } = {},
) {
  let response;
  try {
    response = await client.request({
      url: path,
      method,
      data: body,
      timeout: timeoutMs,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
    });
  } catch (error) {
    throw fromAxiosFailure(error);
  }

  // an empty or damaged body counts as no body
  const data = response.status !== 204 && response.data && typeof response.data === 'object' ? response.data : null;
  if (response.status < 200 || response.status >= 300) {
    throw fromResponse(response.status, data, response.headers?.['retry-after']);
  }
  return data;
}

// upload('/path', {formData, token, onProgress}) -> parsed JSON. A file upload with progress (0..1): axios reports
// how much has been sent (onUploadProgress). Throws ApiError, like request().
export async function upload(path, { formData, token, onProgress, timeoutMs = 30 * 60 * 1000 }) {
  let response;
  try {
    response = await client.post(path, formData, {
      timeout: timeoutMs,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'multipart/form-data',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      transformRequest: data => data, // send the FormData as it is
      onUploadProgress: onProgress
        ? event => {
            if (event.total > 0) {
              onProgress(event.loaded / event.total);
            }
          }
        : undefined,
    });
  } catch (error) {
    throw fromAxiosFailure(error);
  }
  const data = response.data && typeof response.data === 'object' ? response.data : null;
  if (response.status < 200 || response.status >= 300) {
    throw fromResponse(response.status, data, response.headers?.['retry-after']);
  }
  return data;
}
