import React, {useCallback, useRef, useState} from 'react';
import {RefreshControl} from 'react-native';
import {colors} from '../theme';

// Pull-down-to-refresh for a screen. `loader` is an async function that loads the screen's data again.
// The spinner stays until it has finished (or failed), and a failure never reaches the screen as a crash.
//  - ScrollView: refreshControl={pull.control}
//  - FlatList:   refreshing={pull.refreshing} onRefresh={pull.onRefresh}
export default function useRefresh(loader) {
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(loader);
  latest.current = loader;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await latest.current();
    } catch {
      // the screen keeps what it already shows
    } finally {
      setRefreshing(false);
    }
  }, []);

  const control = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      colors={[colors.primary]}
      tintColor={colors.primary}
    />
  );

  return {refreshing, onRefresh, control};
}
