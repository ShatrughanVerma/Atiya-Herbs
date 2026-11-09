import React from 'react';
import {Image, StyleSheet, View} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Avatar from '../../calling/Avatar';
import {colors} from '../../theme';

// A doctor's photo. `square` is the rounded square of the doctor cards (a soft green tile with a person icon
// until a photo is added); otherwise a round photo, or the initials.
export default function DoctorAvatar({doctor, size = 64, square = false}) {
  if (!square) {
    return <Avatar name={doctor.name.replace(/^Dr\.?\s+/i, '')} photo={doctor.photoUrl} size={size} />;
  }
  const box = {width: size, height: size, borderRadius: size * 0.22};
  if (doctor.photoUrl) {
    return <Image source={{uri: doctor.photoUrl}} style={[box, styles.photo]} resizeMode="cover" accessibilityLabel={`${doctor.name} photo`} />;
  }
  return (
    <View style={[box, styles.placeholder]}>
      <Icon name="account-outline" size={size * 0.5} color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  photo: {backgroundColor: colors.primaryLight},
  placeholder: {backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center'},
});
