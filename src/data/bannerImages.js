// The banner pictures that are part of the app. The server's banners name one of these keys (or give a full https
// address for a picture of their own).
const BUNDLED = {
  banner1: require('../assets/images/banner1.jpg'),
  banner_shilajit: require('../assets/images/banner_shilajit.jpg'),
  banner_gond_siyah: require('../assets/images/banner_gond_siyah.jpg'),
  banner_cumin_vinegar: require('../assets/images/banner_cumin_vinegar.jpg'),
};

// -> an Image `source`, or null when the banner has no picture the app knows
export function bannerImageSource(image) {
  if (typeof image !== 'string' || !image) {
    return null;
  }
  if (/^https:\/\//i.test(image)) {
    return { uri: image };
  }
  return BUNDLED[image] ?? null;
}
