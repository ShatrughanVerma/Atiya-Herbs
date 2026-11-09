import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { bannerImageSource } from '../data/bannerImages';
import {
  fetchAllProducts,
  fetchBanners,
  fetchCategories,
  fetchConcerns,
} from '../services/shopApi';

// The shop's data (categories, concerns, products, banners) comes from the server and from nowhere else.
//  - The last good answer is saved on the phone. It is shown straight away while the server is asked again, and
//    kept if the server cannot be reached (`stale` is true then).
//  - Without a saved answer and without the server there is NO data: `ready` is false and `status` is 'error', so
//    the screens show a "server not reachable" message with a Retry button. The app never invents products.

const CACHE_KEY = 'atiya.catalog.v1';
const CACHE_VERSION = 1;

const CatalogContext = createContext(null);

const isList = value => Array.isArray(value);

// A saved answer is only used when it has the shape we wrote
const readCache = async () => {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) {
      return null;
    }
    const saved = JSON.parse(raw);
    if (
      saved?.version !== CACHE_VERSION ||
      !isList(saved.categories) ||
      !isList(saved.concerns) ||
      !isList(saved.products) ||
      !isList(saved.banners)
    ) {
      return null;
    }
    return saved;
  } catch {
    return null;
  }
};

const writeCache = async data => {
  try {
    await AsyncStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ version: CACHE_VERSION, savedAt: Date.now(), ...data }),
    );
  } catch {
    // The shop still works; only the offline copy was not saved
  }
};

export function CatalogProvider({ children }) {
  // status: 'loading' (nothing to show yet) | 'ready' (data is shown) | 'error' (no data and the server failed)
  const [state, setState] = useState({
    status: 'loading',
    data: null,
    stale: false,
    error: null,
  });
  const alive = useRef(true);
  const loading = useRef(null);

  const load = useCallback(() => {
    if (loading.current) {
      return loading.current;
    }
    const run = (async () => {
      try {
        const [categories, concerns, products, banners] = await Promise.all([
          fetchCategories(),
          fetchConcerns(),
          fetchAllProducts(),
          fetchBanners(),
        ]);
        const data = { categories, concerns, products, banners };
        if (alive.current) {
          setState({ status: 'ready', data, stale: false, error: null });
        }
        await writeCache(data);
      } catch (error) {
        if (alive.current) {
          setState(prev =>
            prev.data
              ? { ...prev, status: 'ready', stale: true, error }
              : { status: 'error', data: null, stale: false, error },
          );
        }
      }
    })().finally(() => {
      loading.current = null;
    });
    loading.current = run;
    return run;
  }, []);

  useEffect(() => {
    alive.current = true;
    (async () => {
      const cached = await readCache();
      if (cached && alive.current) {
        setState(prev =>
          prev.data
            ? prev
            : {
                status: 'ready',
                data: {
                  categories: cached.categories,
                  concerns: cached.concerns,
                  products: cached.products,
                  banners: cached.banners,
                },
                stale: true,
                error: null,
              },
        );
      }
      await load();
    })();
    return () => {
      alive.current = false;
    };
  }, [load]);

  const retry = useCallback(() => {
    setState(prev => (prev.data ? prev : { ...prev, status: 'loading' }));
    return load();
  }, [load]);

  const value = useMemo(() => {
    const data = state.data;
    const products = data?.products ?? [];
    const categories = data?.categories ?? [];
    const concerns = data?.concerns ?? [];
    const banners = (data?.banners ?? []).map(b => ({
      ...b,
      image: bannerImageSource(b.image),
    }));
    return {
      status: state.status,
      ready: !!data,
      loading: state.status === 'loading',
      stale: state.stale, // the data is the saved copy because the server could not be reached
      error: state.error,
      products,
      categories,
      concerns,
      banners,
      getProduct: id => products.find(p => p.id === id),
      getCategory: id => categories.find(c => c.id === id),
      getConcern: id => concerns.find(c => c.id === id),
      retry,
    };
  }, [state, retry]);

  return (
    <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
  );
}

export function useCatalog() {
  const ctx = useContext(CatalogContext);
  if (!ctx) {
    throw new Error('useCatalog must be used inside CatalogProvider');
  }
  return ctx;
}
