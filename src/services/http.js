import { API_BASE_URL, API_TIMEOUT_MS } from '../config/api';

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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    const kind = error?.name === 'AbortError' ? 'timeout' : 'network';
    throw new ApiError(kind, FALLBACK[kind]);
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  if (response.status !== 204) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    throw fromResponse(
      response.status,
      data,
      response.headers?.get?.('Retry-After'),
    );
  }
  return data;
}

// upload('/path', {formData, token, onProgress}) -> parsed JSON. A file upload with progress (0..1); it uses
// XMLHttpRequest because fetch cannot report how much has been sent. Throws ApiError, like request().
export function upload(path, { formData, token, onProgress, timeoutMs = 30 * 60 * 1000 }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE_URL}${path}`);
    xhr.setRequestHeader('Accept', 'application/json');
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }
    xhr.timeout = timeoutMs;
    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = event => {
        if (event.lengthComputable && event.total > 0) {
          onProgress(event.loaded / event.total);
        }
      };
    }
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
      } else {
        reject(fromResponse(xhr.status, data, xhr.getResponseHeader('Retry-After')));
      }
    };
    xhr.onerror = () => reject(new ApiError('network', FALLBACK.network));
    xhr.ontimeout = () => reject(new ApiError('timeout', FALLBACK.timeout));
    xhr.send(formData);
  });
}

