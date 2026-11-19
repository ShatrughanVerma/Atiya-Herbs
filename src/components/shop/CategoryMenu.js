import React, {useRef, useState} from 'react';
import {Animated, Dimensions, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {colors, spacing} from '../../theme';

const PANEL_WIDTH = Math.min(Dimensions.get('window').width * 0.82, 340);

// The menu button that sits to the right of the search bar. Tapping it slides a panel in from the left edge with
// every category (and how many products it has). Choosing one calls onSelect(category); "View all products" calls
// onAll(). `counts` is {categoryId: number of products}.
export default function CategoryMenu({categories, counts = {}, onSelect, onAll, size = 48}) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const progress = useRef(new Animated.Value(0)).current; // 0 = closed, 1 = fully open

  const show = () => {
    setOpen(true);
    Animated.timing(progress, {toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true}).start();
  };
  // Slides out first, then removes the panel; `then` runs once it is gone (for example to open a category)
  const hide = then => {
    Animated.timing(progress, {toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true}).start(() => {
      setOpen(false);
      if (typeof then === 'function') {
        then();
      }
    });
  };

  const translateX = progress.interpolate({inputRange: [0, 1], outputRange: [-PANEL_WIDTH, 0]});
  const dim = progress.interpolate({inputRange: [0, 1], outputRange: [0, 0.45]});

  return (
    <>
      <Pressable
        style={[styles.button, {width: size, height: size}]}
        onPress={show}
        accessibilityRole="button"
        accessibilityLabel="Categories menu">
        <Icon name="menu" size={28} color={colors.muted} />
      </Pressable>

      <Modal visible={open} transparent animationType="none" statusBarTranslucent onRequestClose={() => hide()}>
        <View style={styles.root}>
          <Animated.View style={[styles.backdrop, {opacity: dim}]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => hide()} accessibilityLabel="Close menu" />
          </Animated.View>

          <Animated.View
            style={[styles.panel, {width: PANEL_WIDTH, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12, transform: [{translateX}]}]}>
            <View style={styles.header}>
              <View>
                <Text style={styles.title}>Shop by category</Text>
                <Text style={styles.subtitle}>{categories.length} categories</Text>
              </View>
              <Pressable style={styles.close} onPress={() => hide()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close menu">
                <Icon name="close" size={22} color={colors.text} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
              {categories.map(cat => (
                <Pressable
                  key={cat.id}
                  style={({pressed}) => [styles.row, pressed && styles.rowPressed]}
                  onPress={() => hide(() => onSelect(cat))}
                  accessibilityRole="button"
                  accessibilityLabel={cat.name}>
                  <View style={styles.rowIcon}>
                    <Icon name={cat.icon} size={22} color={colors.primary} />
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.name} numberOfLines={1}>
                      {cat.name}
                    </Text>
                    {counts[cat.id] !== undefined && <Text style={styles.count}>{counts[cat.id]} products</Text>}
                  </View>
                  <Icon name="chevron-right" size={22} color={colors.muted} />
                </Pressable>
              ))}
            </ScrollView>

            <Pressable style={styles.allBtn} onPress={() => hide(onAll)} accessibilityRole="button" accessibilityLabel="View all products">
              <Text style={styles.allText}>View all products</Text>
              <Icon name="arrow-right" size={18} color="#fff" />
            </Pressable>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // No circle or border: just the grey icon, with a full-size area to tap
  button: {alignItems: 'center', justifyContent: 'center'},
  root: {flex: 1, flexDirection: 'row', justifyContent: 'flex-start'},
  backdrop: {...StyleSheet.absoluteFillObject, backgroundColor: '#000'},
  panel: {
    height: '100%',
    backgroundColor: colors.background,
    borderTopRightRadius: 24,
    borderBottomRightRadius: 24,
    paddingHorizontal: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: {width: 4, height: 0},
    elevation: 16,
  },
  header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, marginBottom: 4},
  title: {fontSize: 20, fontWeight: '800', color: colors.primaryDark},
  subtitle: {fontSize: 12.5, color: colors.muted, marginTop: 2},
  close: {width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card},
  list: {paddingBottom: spacing.sm},
  row: {flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 8, borderRadius: 14, marginBottom: 4},
  rowPressed: {backgroundColor: colors.primaryLight},
  rowIcon: {width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center'},
  rowText: {flex: 1, marginLeft: 14},
  name: {fontSize: 15.5, fontWeight: '600', color: colors.text},
  count: {fontSize: 12, color: colors.muted, marginTop: 2},
  allBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.primaryDark,
    marginTop: spacing.sm,
  },
  allText: {color: '#fff', fontWeight: '700', fontSize: 15, marginRight: 8},
});
