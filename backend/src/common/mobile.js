// Indian mobile numbers. Everything is stored as the plain 10 digits, so +91 98765 43210,
// 098765-43210 and 9876543210 are the same person.
const MOBILE_PATTERN = /^[6-9]\d{9}$/;

function normalizeMobile(raw) {
  if (typeof raw !== 'string') {
    return '';
  }
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return MOBILE_PATTERN.test(digits) ? digits : '';
}

// For logs and audit trails: the full number is personal data, so keep only the last 4 digits
const maskMobile = mobile => `******${mobile.slice(-4)}`;

module.exports = {MOBILE_PATTERN, normalizeMobile, maskMobile};
