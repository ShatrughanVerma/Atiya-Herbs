import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { CATEGORIES, CONCERNS, PRODUCTS } from '../../data/catalog';
import { colors, spacing } from '../../theme';
import {
  DEFAULT_FILTERS,
  PRICE_RANGES,
  RATING_OPTIONS,
  SORT_OPTIONS,
  applyFilters,
  countActiveFilters,
} from '../../utils/productFilters';

const toggle = (list, id) =>
  list.includes(id) ? list.filter(x => x !== id) : [...list, id];

function Chip({ label, active, onPress, icon }) {
  return (
    <Pressable
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
    >
      {!!icon && (
        <Icon
          name={icon}
          size={14}
          color={active ? '#fff' : colors.primary}
          style={styles.chipIcon}
        />
      )}
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

/**
 * Bottom sheet for sorting and filtering products.
 * `baseProducts` is the list the filters apply to, so the button can show a live result count.
 */
export default function FilterSheet({
  visible,
  initial,
  onApply,
  onClose,
  baseProducts = PRODUCTS,
}) {
  const { bottom } = useSafeAreaInsets();
  const [draft, setDraft] = useState(initial || DEFAULT_FILTERS);

  useEffect(() => {
    if (visible) {
      setDraft(initial || DEFAULT_FILTERS);
    }
  }, [visible, initial]);

  const resultCount = useMemo(
    () => applyFilters(baseProducts, draft).length,
    [baseProducts, draft],
  );
  const active = countActiveFilters(draft);
  const set = patch => setDraft(d => ({ ...d, ...patch }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Close filters"
        />
        <View style={[styles.sheet, { paddingBottom: bottom }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Filter & Sort</Text>
            <Pressable
              onPress={() => setDraft(DEFAULT_FILTERS)}
              hitSlop={8}
              disabled={active === 0 && draft.sort === 'popular'}
            >
              <Text
                style={[
                  styles.clear,
                  active === 0 &&
                    draft.sort === 'popular' &&
                    styles.clearDisabled,
                ]}
              >
                Clear all
              </Text>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
          >
            <Section title="Sort by">
              {SORT_OPTIONS.map(o => {
                const selected = draft.sort === o.id;
                return (
                  <Pressable
                    key={o.id}
                    style={styles.radioRow}
                    onPress={() => set({ sort: o.id })}
                  >
                    <Text
                      style={[
                        styles.radioLabel,
                        selected && styles.radioLabelActive,
                      ]}
                    >
                      {o.label}
                    </Text>
                    <Icon
                      name={selected ? 'radiobox-marked' : 'radiobox-blank'}
                      size={22}
                      color={selected ? colors.primary : colors.muted}
                    />
                  </Pressable>
                );
              })}
            </Section>

            <Section title="Health concern">
              <View style={styles.chipWrap}>
                {CONCERNS.map(c => (
                  <Chip
                    key={c.id}
                    label={c.name}
                    icon={c.icon}
                    active={draft.concerns.includes(c.id)}
                    onPress={() =>
                      set({ concerns: toggle(draft.concerns, c.id) })
                    }
                  />
                ))}
              </View>
            </Section>

            <Section title="Category">
              <View style={styles.chipWrap}>
                {CATEGORIES.map(c => (
                  <Chip
                    key={c.id}
                    label={c.name}
                    active={draft.categories.includes(c.id)}
                    onPress={() =>
                      set({ categories: toggle(draft.categories, c.id) })
                    }
                  />
                ))}
              </View>
            </Section>

            <Section title="Price">
              <View style={styles.chipWrap}>
                {PRICE_RANGES.map(r => (
                  <Chip
                    key={r.id}
                    label={r.label}
                    active={draft.priceRanges.includes(r.id)}
                    onPress={() =>
                      set({ priceRanges: toggle(draft.priceRanges, r.id) })
                    }
                  />
                ))}
              </View>
            </Section>

            <Section title="Customer rating">
              <View style={styles.chipWrap}>
                {RATING_OPTIONS.map(r => (
                  <Chip
                    key={r.id}
                    label={r.label}
                    active={draft.minRating === r.id}
                    onPress={() =>
                      set({ minRating: draft.minRating === r.id ? null : r.id })
                    }
                  />
                ))}
              </View>
            </Section>

            <View style={styles.switchRow}>
              <View>
                <Text style={styles.sectionTitle}>In stock only</Text>
                <Text style={styles.switchNote}>
                  Hide products that are sold out
                </Text>
              </View>
              <Switch
                value={draft.inStockOnly}
                onValueChange={v => set({ inStockOnly: v })}
                trackColor={{ true: colors.primary, false: colors.border }}
                thumbColor="#fff"
              />
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Pressable style={styles.applyBtn} onPress={() => onApply(draft)}>
              <Text style={styles.applyText}>
                Show {resultCount} {resultCount === 1 ? 'product' : 'products'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginTop: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: 18, fontWeight: '800', color: colors.text },
  clear: { color: colors.accent, fontWeight: '700' },
  clearDisabled: { color: colors.muted },
  body: { padding: spacing.md },
  section: { marginBottom: spacing.lg },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 10,
  },
  radioRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  radioLabel: { fontSize: 14, color: colors.text },
  radioLabelActive: { fontWeight: '700', color: colors.primary },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
    marginBottom: 8,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipIcon: { marginRight: 5 },
  chipText: { fontSize: 13, color: colors.text, fontWeight: '500' },
  chipTextActive: { color: '#fff', fontWeight: '700' },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  switchNote: { fontSize: 12, color: colors.muted, marginTop: -6 },
  footer: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  applyBtn: {
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
