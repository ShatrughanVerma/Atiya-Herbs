// Indian mobile numbers. Calls use the plain 10 digits as the user's id, so numbers typed or
// picked in any format (+91 98765-43210, 098765 43210, …) reach the same person.

export const normalizeMobile = raw => {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return /^[6-9]\d{9}$/.test(digits) ? digits : '';
};

export const formatMobile = mobile => {
  const digits = normalizeMobile(mobile);
  return digits ? `+91 ${digits.slice(0, 5)} ${digits.slice(5)}` : String(mobile || '');
};
