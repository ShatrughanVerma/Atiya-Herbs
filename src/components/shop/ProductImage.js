import React, {useState} from 'react';
import {Image, StyleSheet, View} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {colors} from '../../theme';

// Shows the product photo, or a leaf placeholder while it is missing or fails to load.
export default function ProductImage({uri, style, iconSize = 40}) {
  const [failed, setFailed] = useState(false);

  if (!uri || failed) {
    return (
      <View style={[styles.placeholder, style]}>
        <Icon name="leaf" size={iconSize} color={colors.primary} />
      </View>
    );
  }
  return (
    <Image
      source={{uri}}
      style={style}
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
